import "server-only";
import type postgres from "postgres";
import { ORDERS_PAGE_SIZE } from "@/lib/config/app";
import { addDaysToKey, dateKeyToUtcStart, toDateKey } from "@/lib/dates";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { FINISHED_STATUSES, type HistoryStatus, type OrderStatus } from "@/lib/status";
import { checkTransition } from "@/lib/workflow";
import type { Role } from "@/lib/auth/permissions";
import { DEFAULT_PRIORITY_CODE } from "@/lib/server/config";
import type { Assignee, OrderAttachment, OrderDetail, OrderListItem, StatusHistoryEntry } from "@/lib/types";
import { type OrderSubmissionInput, type OrderUpdateInput } from "@/lib/validation/order";
import { enqueueOrderNotification } from "@/lib/server/repositories/notifications";
import { eventTypeForStatus } from "@/lib/telegram-routing";

const FINISHED = FINISHED_STATUSES as unknown as string[];

export type OrderRow = {
  id: string;
  order_number: string;
  requester_name: string;
  company: string | null;
  department: string;
  title: string;
  design_type: string;
  brand_id: string;
  brand_name: string;
  deadline_at: Date;
  priority: string;
  priority_name: string;
  priority_tone: string;
  status: OrderStatus;
  created_at: Date;
  team_id: string | null;
  team_name: string | null;
  assignees: Assignee[];
};

export function mapListItem(r: OrderRow): OrderListItem {
  return {
    id: r.id,
    orderNumber: r.order_number,
    requesterName: r.requester_name,
    company: r.company,
    department: r.department,
    title: r.title,
    designType: r.design_type,
    brandId: r.brand_id,
    brandName: r.brand_name,
    deadlineAt: r.deadline_at.toISOString(),
    priority: r.priority,
    priorityName: r.priority_name,
    priorityTone: r.priority_tone,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    teamId: r.team_id ?? null,
    teamName: r.team_name ?? null,
    assignees: Array.isArray(r.assignees) ? r.assignees : [],
  };
}

export function listColumns(db: postgres.Sql) {
  return db`o.id, o.order_number, o.requester_name, o.company, o.department, o.title, o.design_type,
            o.brand_id, b.name as brand_name, o.deadline_at, o.priority, p.name as priority_name,
            p.tone as priority_tone, o.status, o.created_at,
            coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id)) as team_id,
            (select t.name from dtic_teams t where t.id = coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id))) as team_name,
            coalesce((
              select json_agg(json_build_object(
                       'id', m.id, 'name', m.full_name, 'division', m.position || ' of ' || d.name, 'isActive', m.is_active
                     ) order by d.sort_order, m.sort_order, m.full_name)
              from order_assignments a
              join dtic_members m on m.id = a.member_id
              join dtic_departments d on d.id = m.department_id
              where a.order_id = o.id
            ), '[]'::json) as assignees`;
}

/** Filter PIC: id member, atau "none" untuk order yang belum ditugaskan. */
function assigneeWhere(db: postgres.Sql, assignee?: string) {
  if (!assignee) return db``;
  if (assignee === "none") return db`and not exists (select 1 from order_assignments a where a.order_id = o.id)`;
  return db`and exists (select 1 from order_assignments a where a.order_id = o.id and a.member_id = ${assignee})`;
}

/** FROM order + brand + level prioritas (nama & warna prioritas dibaca dari database). */
export function fromOrders(db: postgres.Sql) {
  return db`orders o join brands b on b.id = o.brand_id join priority_levels p on p.code = o.priority`;
}

// ---------------------------------------------------------------------------
// Daftar order + filter
// ---------------------------------------------------------------------------

export const DEADLINE_FILTERS = ["overdue", "today", "week", "month"] as const;
export type DeadlineFilter = (typeof DEADLINE_FILTERS)[number];

export const ORDER_SORTS = ["newest", "oldest", "deadline_asc", "deadline_desc"] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];

export type OrderListFilters = {
  q?: string;
  brandId?: string;
  statuses?: OrderStatus[];
  priority?: string;
  /** id member DTIC, atau "none" = belum ditugaskan */
  assignee?: string;
  /** Kategori/tim pekerjaan (dtic_teams.id). */
  teamId?: string;
  /** Periode tanggal masuk (created_at): from inklusif, to eksklusif. */
  from?: Date;
  to?: Date;
  deadline?: DeadlineFilter;
  sort?: OrderSort;
  page?: number;
};

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function deadlineRange(filter: DeadlineFilter, now: Date): { from?: Date; to?: Date; overdue?: boolean } {
  const todayKey = toDateKey(now);
  switch (filter) {
    case "overdue":
      return { overdue: true };
    case "today":
      return { from: dateKeyToUtcStart(todayKey)!, to: dateKeyToUtcStart(addDaysToKey(todayKey, 1))! };
    case "week":
      return { from: dateKeyToUtcStart(todayKey)!, to: dateKeyToUtcStart(addDaysToKey(todayKey, 7))! };
    case "month": {
      const [y, m] = todayKey.split("-").map(Number);
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      return { from: dateKeyToUtcStart(start)!, to: dateKeyToUtcStart(next)! };
    }
  }
}

const SORT_SQL: Record<OrderSort, string> = {
  newest: "o.created_at desc, o.order_number desc",
  oldest: "o.created_at asc, o.order_number asc",
  deadline_asc: "o.deadline_at asc, o.created_at asc",
  deadline_desc: "o.deadline_at desc, o.created_at desc",
};

/**
 * Cakupan data berdasarkan akun. undefined = semua order (Super Admin & Manager).
 * { memberId } = hanya order yang ditugaskan ke member tersebut (Staff). memberId null = tidak ada order.
 */
export type OrderScope = { memberId: string | null } | undefined;

/** Fragmen SQL pembatas. Wajib dipakai setiap query yang bisa dilihat Staff. */
export function scopeWhere(db: postgres.Sql, scope: OrderScope) {
  if (!scope) return db``;
  if (!scope.memberId) return db`and false`;
  return db`and exists (select 1 from order_assignments sa where sa.order_id = o.id and sa.member_id = ${scope.memberId})`;
}

export async function listOrders(filters: OrderListFilters & { scope?: OrderScope }, now = new Date()) {
  const db = sql();
  const page = Math.max(1, filters.page ?? 1);
  const offset = (page - 1) * ORDERS_PAGE_SIZE;
  const q = filters.q?.trim();
  const like = q ? `%${escapeLike(q)}%` : null;
  const range = filters.deadline ? deadlineRange(filters.deadline, now) : null;

  const where = db`
    where true
    ${like
      ? db`and (o.order_number ilike ${like} or o.requester_name ilike ${like}
               or o.company ilike ${like} or b.name ilike ${like} or o.title ilike ${like})`
      : db``}
    ${filters.brandId ? db`and o.brand_id = ${filters.brandId}` : db``}
    ${filters.statuses?.length ? db`and o.status in ${db(filters.statuses)}` : db``}
    ${filters.from ? db`and o.created_at >= ${filters.from}` : db``}
    ${filters.to ? db`and o.created_at < ${filters.to}` : db``}
    ${filters.teamId ? db`and coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id)) = ${filters.teamId}` : db``}
    ${filters.priority ? db`and o.priority = ${filters.priority}` : db``}
    ${assigneeWhere(db, filters.assignee)}
    ${scopeWhere(db, filters.scope)}
    ${range?.overdue ? db`and o.deadline_at < ${now} and o.status not in ${db(FINISHED)}` : db``}
    ${range?.from ? db`and o.deadline_at >= ${range.from}` : db``}
    ${range?.to ? db`and o.deadline_at < ${range.to}` : db``}`;

  const [rows, [{ total }]] = await Promise.all([
    db<OrderRow[]>`
      select ${listColumns(db)}
      from ${fromOrders(db)}
      ${where}
      order by ${db.unsafe(SORT_SQL[filters.sort ?? "newest"])}
      limit ${ORDERS_PAGE_SIZE} offset ${offset}`,
    db<{ total: number }[]>`select count(*)::int as total from ${fromOrders(db)} ${where}`,
  ]);

  return { items: rows.map(mapListItem), total, page, pageSize: ORDERS_PAGE_SIZE };
}

/** Order untuk Workboard (semua status). */
export async function listBoardOrders(filters: { brandId?: string; q?: string; assignee?: string; scope?: OrderScope } = {}) {
  const db = sql();
  const q = filters.q?.trim();
  const like = q ? `%${escapeLike(q)}%` : null;
  const rows = await db<OrderRow[]>`
    select ${listColumns(db)}
    from ${fromOrders(db)}
    where true
    ${filters.brandId ? db`and o.brand_id = ${filters.brandId}` : db``}
    ${assigneeWhere(db, filters.assignee)}
    ${scopeWhere(db, filters.scope)}
    ${like ? db`and (o.order_number ilike ${like} or o.title ilike ${like} or o.requester_name ilike ${like})` : db``}
    order by o.deadline_at asc
    limit 1000`;
  return rows.map(mapListItem);
}

/** Order dengan deadline di rentang [from, to) untuk kalender. */
/** Filter kalender & perhatian. Tanggal dalam kunci YYYY-MM-DD (WIB, inklusif). */
export type CalendarFilters = {
  brandId?: string;
  status?: OrderStatus;
  /** id member, atau "none" = belum ada PIC. */
  pic?: string;
  priority?: string;
  /** Kategori/tim pekerjaan (dtic_teams.id). */
  teamId?: string;
  /** Jenis pekerjaan (design_order_types.id). */
  typeId?: string;
  /** Pencarian judul, nomor, atau nama pemohon. */
  q?: string;
  /** Hanya pekerjaan yang lewat deadline dan belum selesai/dibatalkan. */
  overdue?: boolean;
  fromKey?: string;
  toKey?: string;
};

const WIB = "Asia/Jakarta";

/** Klausa WHERE bersama untuk kalender: sama dipakai daftar, statistik, dan bagian perhatian. */
function calendarWhere(db: postgres.Sql, f: CalendarFilters, scope?: OrderScope, now = new Date()) {
  const like = f.q?.trim() ? `%${escapeLike(f.q.trim())}%` : null;
  return db`
    ${f.brandId ? db`and o.brand_id = ${f.brandId}` : db``}
    ${f.teamId ? db`and coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id)) = ${f.teamId}` : db``}
    ${f.typeId ? db`and o.design_order_type_id = ${f.typeId}` : db``}
    ${like ? db`and (o.title ilike ${like} or o.order_number ilike ${like} or o.requester_name ilike ${like})` : db``}
    ${f.overdue ? db`and o.deadline_at < ${now} and o.status not in ${db(FINISHED)}` : db``}
    ${f.status ? db`and o.status = ${f.status}` : db``}
    ${f.priority ? db`and o.priority = ${f.priority}` : db``}
    ${f.pic === "none" ? db`and not exists (select 1 from order_assignments a where a.order_id = o.id)` : f.pic ? db`and exists (select 1 from order_assignments a where a.order_id = o.id and a.member_id = ${f.pic})` : db``}
    ${f.fromKey ? db`and (o.deadline_at at time zone ${WIB})::date >= ${f.fromKey}::date` : db``}
    ${f.toKey ? db`and (o.deadline_at at time zone ${WIB})::date <= ${f.toKey}::date` : db``}
    ${scopeWhere(db, scope)}`;
}

/** Order berdeadline dalam rentang [from, to) untuk kalender. Deadline kosong tidak pernah masuk (kolom wajib). */
export async function listOrdersByDeadline(range: { from: Date; to: Date } & CalendarFilters & { scope?: OrderScope }) {
  const db = sql();
  const rows = await db<OrderRow[]>`
    select ${listColumns(db)}
    from ${fromOrders(db)}
    where o.deadline_at >= ${range.from} and o.deadline_at < ${range.to}
    ${calendarWhere(db, range, range.scope)}
    order by o.deadline_at asc`;
  return rows.map(mapListItem);
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export async function getOrderDetail(id: string): Promise<OrderDetail | null> {
  const db = sql();
  const rows = await db<
    (OrderRow & {
      design_size: string;
      brief: string;
      brief_year: number | null;
      brief_reference: string | null;
      design_requirements: string | null;
      internal_notes: string | null;
      updated_at: Date;
      completed_at: Date | null;
      brand_is_active: boolean;
      design_order_type_id: string | null;
      team_id: string | null;
      brief_rich: unknown;
      drive_url: string | null;
      requester_message: string | null;
      result_url: string | null;
      requester_whatsapp: string | null;
      has_tracking?: boolean;
    })[]
  >`
    select ${listColumns(db)}, o.design_size, o.brief, o.brief_year, o.brief_reference, o.design_requirements,
           o.internal_notes, o.updated_at, o.completed_at, b.is_active as brand_is_active,
           o.design_order_type_id, o.brief_rich, o.drive_url, o.requester_message, o.result_url, o.requester_whatsapp,
           false as has_tracking
    from ${fromOrders(db)}
    where o.id = ${id}`;
  const r = rows[0];
  if (!r) return null;

  const [attachments, history] = await Promise.all([
    db<{ id: string; file_name: string; mime_type: string; file_size: number; created_at: Date }[]>`
      select id, file_name, mime_type, file_size, created_at
      from order_attachments where order_id = ${id} order by created_at, file_name`,
    db<{ id: string; previous_status: HistoryStatus | null; new_status: HistoryStatus; changed_at: Date; notes: string | null; changed_by_name: string | null; is_first: boolean }[]>`
      select h.id, h.previous_status, h.new_status, h.changed_at, h.notes, u.full_name as changed_by_name,
             h.previous_status is null as is_first
      from order_status_history h left join app_users u on u.id = h.changed_by
      where h.order_id = ${id} order by h.changed_at desc, h.id desc`,
  ]);

  return {
    ...mapListItem(r),
    designSize: r.design_size,
    brief: r.brief,
    briefYear: r.brief_year,
    briefReference: r.brief_reference,
    designRequirements: r.design_requirements,
    internalNotes: r.internal_notes,
    updatedAt: r.updated_at.toISOString(),
    completedAt: r.completed_at?.toISOString() ?? null,
    brandIsActive: r.brand_is_active,
    designOrderTypeId: r.design_order_type_id,
    teamId: r.team_id,
    briefRich: r.brief_rich ?? null,
    driveUrl: r.drive_url,
    requesterMessage: r.requester_message,
    resultUrl: r.result_url,
    requesterWhatsapp: r.requester_whatsapp,
    hasTrackingCode: false,
    attachments: attachments.map(
      (a): OrderAttachment => ({
        id: a.id,
        fileName: a.file_name,
        mimeType: a.mime_type,
        fileSize: Number(a.file_size),
        createdAt: a.created_at.toISOString(),
      }),
    ),
    history: history.map(
      (h): StatusHistoryEntry => ({
        id: h.id,
        previousStatus: h.previous_status,
        newStatus: h.new_status,
        changedAt: h.changed_at.toISOString(),
        notes: h.notes,
        // Pelaku: akun internal; baris pertama = pemohon lewat form; tanpa akun = sistem (mis. migrasi).
        actor: h.changed_by_name ?? (h.is_first ? "Pemohon (form pengajuan)" : "Sistem"),
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Mutasi
// ---------------------------------------------------------------------------

export type NewAttachment = { fileName: string; storagePath: string; mimeType: string; fileSize: number };

type CreatedOrderRow = { id: string; order_number: string; created_at: Date; deadline_at: Date; brand_name: string; design_type: string };

function mapCreated(r: CreatedOrderRow) {
  return {
    id: r.id,
    orderNumber: r.order_number,
    createdAt: r.created_at.toISOString(),
    deadlineAt: r.deadline_at.toISOString(),
    brandName: r.brand_name,
    designType: r.design_type,
  };
}

export async function findOrderBySubmissionKey(key: string) {
  const rows = await sql()<CreatedOrderRow[]>`
    select o.id, o.order_number, o.created_at, o.deadline_at, b.name as brand_name, o.design_type
    from orders o join brands b on b.id = o.brand_id where o.submission_key = ${key}`;
  return rows[0] ? mapCreated(rows[0]) : null;
}

type Tx = postgres.TransactionSql;

/** Jenis order dari database. `allowInactiveId` = jenis yang sudah terpasang pada order (boleh tetap dipakai). */
async function resolveDesignType(tx: Tx, typeId: string, other: string | null, allowInactiveId?: string | null) {
  const [t] = await tx<{ id: string; name: string; requires_detail: boolean; is_active: boolean; team_id: string | null }[]>`
    select id, name, requires_detail, is_active, team_id from design_order_types where id = ${typeId}`;
  if (!t || (!t.is_active && t.id !== allowInactiveId))
    throw new AppError("Jenis order tidak tersedia.", 422, { designTypeId: "Jenis order tidak tersedia. Pilih jenis lain." });
  if (t.requires_detail) {
    if (!other || other.length < 2)
      throw new AppError("Sebutkan jenis desain.", 422, { designTypeOther: "Sebutkan jenis desain yang dibutuhkan." });
    return { id: t.id, label: other, teamId: t.team_id };
  }
  return { id: t.id, label: t.name, teamId: t.team_id };
}

/**
 * Validasi PIC pilihan pemohon. Kategori (tim) harus aktif, jenis pekerjaan harus milik tim itu, dan SETIAP PIC
 * harus anggota AKTIF tim tersebut. Klien tidak bisa menetapkan tim lain atau ID sembarang.
 */
async function resolveSelectedPics(tx: Tx, teamId: string, typeTeamId: string | null, picIds: string[]): Promise<{ teamName: string; memberIds: string[] }> {
  const [team] = await tx<{ id: string; name: string; is_active: boolean }[]>`select id, name, is_active from dtic_teams where id = ${teamId} for share`;
  if (!team || !team.is_active) {
    throw new AppError("Kategori pekerjaan tidak tersedia.", 422, { teamId: "Kategori pekerjaan tidak tersedia. Pilih kategori lain." });
  }
  if (typeTeamId !== team.id) {
    throw new AppError("Jenis pekerjaan tidak termasuk kategori yang dipilih.", 422, { designTypeId: "Pilih jenis pekerjaan dari kategori yang dipilih." });
  }
  const members = await tx<{ id: string }[]>`
    select m.id from dtic_team_members tm join dtic_members m on m.id = tm.member_id
    where tm.team_id = ${team.id} and m.is_active
    for share of m`;
  const allowed = new Set(members.map((m) => m.id));
  if (allowed.size === 0) {
    console.error(`[submitOrder] tim "${team.name}" tidak memiliki anggota aktif; pengajuan ditolak tanpa penugasan.`);
    throw new AppError(`Tim ${team.name} belum memiliki anggota aktif. Hubungi tim DTIC.`, 422, { teamId: "Tim untuk kategori ini belum memiliki anggota aktif." });
  }
  const invalid = picIds.filter((id) => !allowed.has(id));
  if (invalid.length > 0) {
    console.error(`[submitOrder] ${invalid.length} PIC ditolak: bukan anggota aktif tim "${team.name}".`);
    throw new AppError("PIC yang dipilih tidak valid.", 422, { picIds: `Pilih anggota aktif dari tim ${team.name}.` });
  }
  return { teamName: team.name, memberIds: picIds };
}

/** Prioritas dari database; kosong → default konfigurasi server. */
async function resolvePriority(tx: Tx, code: string | null, allowInactiveCode?: string | null) {
  const wanted = code ?? DEFAULT_PRIORITY_CODE;
  const [p] = await tx<{ code: string; is_active: boolean }[]>`select code, is_active from priority_levels where code = ${wanted}`;
  if (p && (p.is_active || p.code === allowInactiveCode)) return p.code;
  if (code) throw new AppError("Prioritas tidak tersedia.", 422, { priority: "Prioritas tidak tersedia. Pilih level lain." });
  const [fallback] = await tx<{ code: string }[]>`select code from priority_levels where is_active order by sort_order, name limit 1`;
  if (!fallback) throw new AppError("Belum ada level prioritas aktif. Hubungi tim DTIC.", 503);
  return fallback.code;
}

/**
 * Ganti daftar PIC sebuah order (dalam transaksi pemanggil).
 * Member baru harus aktif; member nonaktif yang SUDAH ditugaskan boleh tetap tercatat.
 */
export type AssignmentChange = {
  memberIds: string[];
  reason: string | null;
  /** PIC yang dilihat pengguna; null = tanpa pemeriksaan konflik (jalur form edit). */
  expectedMemberIds: string[] | null;
  actorUserId: string;
  /** Nama pelaku dari session terautentikasi (bukan dari payload klien). */
  actorName: string;
  source: "pic_panel" | "order_edit";
};

export type AssignmentResult = {
  changed: boolean;
  /** add = tambah (PIC lama tetap), remove = hapus, replace = ganti sebagian, move = pindah (semua PIC lama dilepas). */
  operation: "add" | "remove" | "replace" | "move" | null;
  before: { id: string; name: string }[];
  after: { id: string; name: string }[];
  /** Antrean notifikasi "Perubahan PIC" (null bila tidak ada perubahan atau notifikasi tidak dibuat). */
  outboxId: string | null;
  /** Status penjadwalan notifikasi, terpisah dari status penyimpanan PIC. */
  notification: "queued" | "failed" | null;
};

/**
 * Ubah PIC order dalam transaksi pemanggil dengan baris order terkunci.
 * - Order selesai/dibatalkan → ditolak (PIC terkunci).
 * - expectedMemberIds tidak cocok → 409 (ada perubahan lain); tidak menimpa diam-diam.
 * - Anggota baru harus aktif DAN anggota tim kategori order (order lama tanpa tim: hanya cek aktif).
 * - Tanpa perubahan → tidak ada perubahan & tidak ada audit palsu.
 * - Perubahan dicatat di auth_audit_log (sebelum/sesudah, operasi, alasan) dalam transaksi yang sama.
 * - Status order TIDAK diubah di sini.
 */
async function applyAssignmentChange(tx: Tx, orderId: string, change: AssignmentChange): Promise<AssignmentResult> {
  const [order] = await tx<{ order_number: string; title: string; status: OrderStatus; team_id: string | null }[]>`
    select o.order_number, o.title, o.status, coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id)) as team_id from orders o where o.id = ${orderId} for update`;
  if (!order) throw new NotFoundError("Order tidak ditemukan.");
  if (order.status === "completed" || order.status === "cancelled") {
    throw new AppError("Order sudah selesai atau dibatalkan; PIC tidak dapat diubah.", 409, { memberIds: "PIC terkunci untuk order ini." });
  }
  // Daftar kosong dijawab tanpa query: `in ('')` bukan UUID valid dan akan menggagalkan transaksi (mis. perubahan yang hanya menghapus PIC).
  const namesOf = async (ids: string[]) =>
    ids.length ? tx<{ id: string; name: string }[]>`select id, full_name as name from dtic_members where id in ${tx(ids)} order by full_name` : [];
  const current = await tx<{ id: string; name: string }[]>`
    select m.id, m.full_name as name from order_assignments oa join dtic_members m on m.id = oa.member_id
    where oa.order_id = ${orderId} order by m.full_name`;
  const currentIds = current.map((m) => m.id);
  if (change.expectedMemberIds) {
    const seen = [...change.expectedMemberIds].sort().join(",");
    if (seen !== [...currentIds].sort().join(",")) {
      throw new AppError("PIC order sudah berubah oleh pengguna lain. Muat ulang halaman lalu coba lagi.", 409, { memberIds: "PIC sudah berubah. Muat ulang halaman." });
    }
  }
  const next = [...new Set(change.memberIds)];
  const added = next.filter((id) => !currentIds.includes(id));
  const removed = currentIds.filter((id) => !next.includes(id));
  if (added.length === 0 && removed.length === 0) return { changed: false, operation: null, before: current, after: current, outboxId: null, notification: null };
  if (!change.reason?.trim()) throw new AppError("Alasan perubahan PIC wajib diisi.", 422, { assigneeReason: "Isi alasan perubahan PIC." });

  if (added.length) {
    const found = await tx<{ id: string; is_active: boolean }[]>`select id, is_active from dtic_members where id in ${tx(added)} for share`;
    if (found.length !== added.length)
      throw new AppError("Member tidak ditemukan.", 422, { memberIds: "Ada member yang tidak ditemukan. Muat ulang halaman." });
    if (found.some((m) => !m.is_active))
      throw new AppError("Member nonaktif tidak bisa ditugaskan.", 422, { memberIds: "Member nonaktif tidak bisa ditugaskan." });
    if (order.team_id) {
      const inTeam = new Set((await tx<{ member_id: string }[]>`select member_id from dtic_team_members where team_id = ${order.team_id} and member_id in ${tx(added)}`).map((r) => r.member_id));
      if (added.some((id) => !inTeam.has(id)))
        throw new AppError("PIC harus anggota tim yang sesuai dengan kategori order.", 422, { memberIds: "Pilih anggota dari tim kategori pekerjaan ini." });
    }
  }
  if (removed.length) await tx`delete from order_assignments where order_id = ${orderId} and member_id in ${tx(removed)}`;
  for (const memberId of added) {
    await tx`insert into order_assignments (order_id, member_id) values (${orderId}, ${memberId}) on conflict do nothing`;
  }
  const after = await tx<{ id: string; name: string }[]>`
    select m.id, m.full_name as name from order_assignments oa join dtic_members m on m.id = oa.member_id
    where oa.order_id = ${orderId} order by m.full_name`;
  const kept = currentIds.filter((id) => next.includes(id));
  const operation = added.length && removed.length ? (kept.length === 0 ? "move" : "replace") : added.length ? "add" : "remove";
  const label = (list: { id: string; name: string }[]) => list.map((m) => m.name);
  const [audit] = await tx<{ id: string }[]>`insert into auth_audit_log (actor_user_id, action, detail)
    values (${change.actorUserId}, 'order_pic_changed', ${tx.json({
      orderId,
      orderNumber: order.order_number,
      title: order.title,
      operation,
      before: label(current),
      after: label(after),
      added: label(await namesOf(added)),
      removed: label(await namesOf(removed)),
      addedIds: added,
      removedIds: removed,
      afterIds: after.map((m) => m.id),
      reason: change.reason,
      actorUserId: change.actorUserId,
      actorName: change.actorName,
      source: change.source,
      result: "ok",
    })})
    returning id::text as id`;
  // Satu perubahan = satu notifikasi "Perubahan PIC" (event_ref = id audit; unik, aman dari retry). Bukan notifikasi order baru.
  // Dijadwalkan dalam SAVEPOINT: bila antrean ditolak database (mis. constraint lama di produksi), hanya antrean yang
  // dibatalkan — penugasan dan audit tetap tersimpan, kegagalan dicatat di log dan audit.
  let outboxId: string | null = null;
  let notification: "queued" | "failed" = "queued";
  try {
    outboxId = await tx.savepoint((sp) => enqueueOrderNotification(sp, { orderId, kind: "pic_changed", eventType: "pic_changed", eventRef: audit.id }));
  } catch (error) {
    notification = "failed";
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "unknown";
    const constraint = error && typeof error === "object" && "constraint_name" in error ? String((error as { constraint_name: unknown }).constraint_name) : "";
    console.error(`[pic] ${order.order_number}: notifikasi perubahan PIC gagal dijadwalkan (kode ${code}${constraint ? `, constraint ${constraint}` : ""}). PIC tetap tersimpan.`);
    await tx`update auth_audit_log set detail = detail || ${tx.json({ notification: "enqueue_failed", notificationError: code })} where id = ${audit.id}::bigint`;
  }
  return { changed: true, operation, before: current, after, outboxId, notification };
}

export async function getOrderStatus(id: string): Promise<OrderStatus | null> {
  const [r] = await sql()<{ status: OrderStatus }[]>`select status from orders where id = ${id}`;
  return r?.status ?? null;
}

/** Ubah PIC order (endpoint khusus penugasan). */
export async function setOrderAssignees(orderId: string, change: AssignmentChange): Promise<AssignmentResult> {
  return sql().begin((tx) => applyAssignmentChange(tx, orderId, change));
}

/** Simpan order + lampiran dalam satu transaksi. Nomor order & timestamp dibuat database. */
export async function insertOrder(orderId: string, input: OrderSubmissionInput, attachments: NewAttachment[]) {
  return sql().begin(async (tx) => {
    const brand = await tx<{ is_active: boolean; name: string }[]>`select is_active, name from brands where id = ${input.brandId} for share`;
    if (!brand[0] || !brand[0].is_active) {
      throw new AppError("Brand pemohon tidak tersedia untuk pengajuan baru.", 422, { brandId: "Brand pemohon tidak tersedia. Pilih brand lain." });
    }
    const type = await resolveDesignType(tx, input.designTypeId, input.designTypeOther);
    const priority = await resolvePriority(tx, input.priority);
    // PIC = anggota tim yang DIPILIH pemohon, setelah divalidasi sebagai anggota aktif tim kategori.
    const team = await resolveSelectedPics(tx, input.teamId, type.teamId, input.picIds);
    const [row] = await tx<CreatedOrderRow[]>`
      insert into orders (
        id, submission_key, requester_name, requester_whatsapp, company, department, brand_id, design_order_type_id, design_type,
        design_size, title, brief, brief_rich, drive_url, deadline_at, priority, status, team_id
      ) values (
        ${orderId}, ${input.submissionKey}, ${input.requesterName}, ${input.requesterWhatsapp}, ${null}, ${input.department}, ${input.brandId},
        ${type.id}, ${type.label}, ${input.designSize}, ${input.title}, ${input.brief},
        ${tx.json(input.briefRich as postgres.JSONValue)}, ${input.driveUrl ?? null}, ${input.deadlineAt}, ${priority}, 'assigned', ${input.teamId}
      )
      returning id, order_number, created_at, deadline_at, ${brand[0].name}::text as brand_name, design_type`;
    for (const a of attachments) {
      await tx`
        insert into order_attachments (order_id, file_name, storage_path, mime_type, file_size)
        values (${orderId}, ${a.fileName}, ${a.storagePath}, ${a.mimeType}, ${a.fileSize})`;
    }
    // Satu order, banyak PIC. Primary key (order_id, member_id) + on conflict mencegah duplikasi.
    for (const memberId of team.memberIds) {
      await tx`insert into order_assignments (order_id, member_id) values (${orderId}, ${memberId}) on conflict do nothing`;
    }
    // Notifikasi dicatat dalam transaksi yang sama: order tersimpan ⇔ ada antrean notifikasi.
    // Tujuan ditentukan dari brand order di transaksi ini (tanpa grup cadangan).
    // Event notifikasi SELALU dibuat di transaksi yang sama: grup brand → grup default → menunggu tujuan.
    await enqueueOrderNotification(tx, { orderId, kind: "order_created", eventType: "new_order", eventRef: "" });
    return mapCreated(row);
  });
}

export async function updateOrder(id: string, input: OrderUpdateInput, actor: { userId: string; name: string }): Promise<{ picOutboxId: string | null }> {
  return sql().begin(async (tx) => {
    const current = await tx<{ brand_id: string; design_order_type_id: string | null; priority: string }[]>`
      select brand_id, design_order_type_id, priority from orders where id = ${id} for update`;
    if (!current[0]) throw new NotFoundError("Order tidak ditemukan.");
    if (current[0].brand_id !== input.brandId) {
      const brand = await tx<{ is_active: boolean }[]>`select is_active from brands where id = ${input.brandId}`;
      if (!brand[0]) throw new AppError("Brand tidak ditemukan.", 422, { brandId: "Brand tidak ditemukan." });
      if (!brand[0].is_active)
        throw new AppError("Brand nonaktif tidak dapat dipilih.", 422, { brandId: "Brand nonaktif tidak dapat dipilih." });
    }
    const type = await resolveDesignType(tx, input.designTypeId, input.designTypeOther, current[0].design_order_type_id);
    const priority = await resolvePriority(tx, input.priority, current[0].priority);
    await tx`
      update orders set
        requester_name = ${input.requesterName}, company = ${input.company}, department = ${input.department},
        requester_whatsapp = coalesce(${input.requesterWhatsapp || null}, requester_whatsapp),
        brand_id = ${input.brandId}, design_order_type_id = ${type.id}, design_type = ${type.label},
        design_size = ${input.designSize}, title = ${input.title}, brief = ${input.brief},
        brief_rich = ${tx.json(input.briefRich as postgres.JSONValue)}, drive_url = ${input.driveUrl ?? null},
        brief_year = ${input.briefYear}, brief_reference = ${input.briefReference},
        design_requirements = ${input.designRequirements}, deadline_at = ${input.deadlineAt}, priority = ${priority}
      where id = ${id}`;
    if (input.assigneeIds) {
      const pic = await applyAssignmentChange(tx, id, {
        memberIds: input.assigneeIds,
        reason: input.assigneeReason ?? null,
        expectedMemberIds: null,
        actorUserId: actor.userId,
        actorName: actor.name,
        source: "order_edit",
      });
      return { picOutboxId: pic.outboxId };
    }
    return { picOutboxId: null };
  });
}

export type StatusActor = { userId: string; role: Role; memberId: string | null };

/**
 * Ubah status lewat aturan transisi terpusat (src/lib/workflow.ts), diperiksa ULANG di dalam
 * transaksi dengan baris order terkunci. Riwayat (termasuk pelaku) dicatat trigger database.
 * Bila transisi perlu notifikasi, antrean Telegram dibuat di transaksi yang sama.
 */
export async function changeOrderStatus(
  id: string,
  to: OrderStatus,
  note: string | null,
  actor: StatusActor,
  isPublicNote = false,
): Promise<{ changed: false } | { changed: true; previousStatus: OrderStatus; outboxId: string | null }> {
  return sql().begin(async (tx) => {
    const [current] = await tx<{ status: OrderStatus }[]>`select status from orders where id = ${id} for update`;
    if (!current) throw new NotFoundError("Order tidak ditemukan.");
    if (current.status === to) return { changed: false as const };
    const assignees = (await tx<{ member_id: string }[]>`select member_id from order_assignments where order_id = ${id}`).map((r) => r.member_id);
    const check = checkTransition({
      from: current.status,
      to,
      actor: { role: actor.role, isAssignee: !!actor.memberId && assignees.includes(actor.memberId) },
      note,
      hasAssignee: assignees.length > 0,
    });
    if (!check.ok) throw new AppError(check.message, check.status, check.field ? { note: check.message } : undefined);

    await tx`select set_config('dtic.status_note', ${note ?? ""}, true)`;
    await tx`select set_config('dtic.status_note_public', ${isPublicNote ? "true" : "false"}, true)`;
    await tx`select set_config('dtic.actor_id', ${actor.userId}, true)`;
    await tx`update orders set status = ${to} where id = ${id}`;

    let outboxId: string | null = null;
    if (check.transition.notify) {
      const [h] = await tx<{ id: string }[]>`
        select id from order_status_history where order_id = ${id} order by changed_at desc, id desc limit 1`;
      outboxId = await enqueueOrderNotification(tx, {
        orderId: id,
        kind: "status_changed",
        eventType: eventTypeForStatus(to),
        eventRef: h.id,
      });
    }
    return { changed: true as const, previousStatus: current.status, outboxId };
  });
}

export async function updateInternalNotes(id: string, notes: string | null) {
  const rows = await sql()`update orders set internal_notes = ${notes} where id = ${id} returning id`;
  if (rows.length === 0) throw new NotFoundError("Order tidak ditemukan.");
}

/** Hapus order (lampiran & riwayat ikut terhapus via ON DELETE CASCADE). Mengembalikan path berkas untuk dibersihkan. */
/**
 * Hapus order permanen (lampiran, riwayat, dan antrean notifikasi ikut terhapus via ON DELETE CASCADE).
 * Notifikasi Telegram yang sudah terkirim tidak dapat ditarik. Jejak audit (nomor, judul, pelaku) dicatat.
 */
export async function deleteOrder(id: string, actorId: string): Promise<string[]> {
  return sql().begin(async (tx) => {
    const [order] = await tx<{ order_number: string; title: string; status: string }[]>`select order_number, title, status from orders where id = ${id} for update`;
    if (!order) throw new NotFoundError("Order tidak ditemukan.");
    const files = await tx<{ storage_path: string }[]>`select storage_path from order_attachments where order_id = ${id}`;
    await tx`delete from orders where id = ${id}`;
    await tx`insert into auth_audit_log (actor_user_id, action, detail)
             values (${actorId}, 'order_deleted', ${tx.json({ orderNumber: order.order_number, title: order.title, status: order.status, attachments: files.length })})`;
    return files.map((f) => f.storage_path);
  });
}

export async function getAttachment(id: string) {
  const rows = await sql()<{ id: string; order_id: string; file_name: string; storage_path: string; mime_type: string; file_size: number }[]>`
    select id, order_id, file_name, storage_path, mime_type, file_size from order_attachments where id = ${id}`;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Pelacakan oleh pemohon (data publik terbatas)
// ---------------------------------------------------------------------------

export type PublicOrderView = {
  orderNumber: string;
  createdAt: string;
  brandName: string;
  designType: string;
  title: string;
  deadlineAt: string;
  status: OrderStatus;
  requesterMessage: string | null;
  resultUrl: string | null;
  /** "628…" (tanpa "+"); null untuk pengajuan lama. */
  requesterWhatsapp: string | null;
  history: { status: OrderStatus; changedAt: string; note: string | null }[];
};

/**
 * Data order untuk verifikasi pelacakan. Mengembalikan hash kode untuk dibandingkan di service.
 * Tidak memuat catatan internal, PIC, lampiran, maupun data pemohon lain.
 */
export async function findOrderForTracking(orderNumber: string) {
  const db = sql();
  const rows = await db<{
    id: string; order_number: string; created_at: Date; brand_name: string; design_type: string; title: string;
    deadline_at: Date; status: OrderStatus; requester_message: string | null; result_url: string | null;
  }[]>`
    select o.id, o.order_number, o.created_at, b.name as brand_name, o.design_type, o.title, o.deadline_at, o.status,
           o.requester_message, o.result_url
    from orders o join brands b on b.id = o.brand_id
    where o.order_number = ${orderNumber}`;
  return rows[0] ?? null;
}

export async function listPicNames(orderId: string): Promise<string[]> {
  const rows = await sql()<{ full_name: string }[]>`
    select m.full_name from order_assignments a join dtic_members m on m.id = a.member_id
    where a.order_id = ${orderId} order by a.assigned_at, m.full_name`;
  return rows.map((r) => r.full_name);
}

export async function getPublicHistory(orderId: string) {
  const rows = await sql()<{ new_status: HistoryStatus; changed_at: Date; note: string | null }[]>`
    select new_status, changed_at, case when is_public_note then notes end as note
    from order_status_history where order_id = ${orderId} order by changed_at asc, id asc`;
  return rows.map((r) => ({ status: r.new_status, changedAt: r.changed_at.toISOString(), note: r.note }));
}

/** Informasi yang ditujukan ke pemohon (diatur tim DTIC). */
export async function updateClientInfo(id: string, info: { requesterMessage: string | null; resultUrl: string | null }) {
  const rows = await sql()`
    update orders set requester_message = ${info.requesterMessage}, result_url = ${info.resultUrl} where id = ${id} returning id`;
  if (rows.length === 0) throw new NotFoundError("Order tidak ditemukan.");
}

