import "server-only";
import type postgres from "postgres";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { enqueueFeedbackNotification } from "@/lib/server/repositories/feedback-telegram";
import type { FeedbackImpact, FeedbackKind, FeedbackPage, FeedbackPriority, FeedbackStatus } from "@/lib/validation/feedback";

export type FeedbackReporter = { userId: string | null; name: string; contact: string | null };

export type NewFeedbackAttachment = { fileName: string; storagePath: string; mimeType: string; fileSize: number };

export type FeedbackTicketInput = {
  kind: FeedbackKind;
  title: string;
  relatedPage: FeedbackPage;
  detail: string;
  impact: FeedbackImpact | null;
  relatedOrderId: string | null;
};

export type FeedbackActor = { userId: string; name: string };

/**
 * Buat tiket + lampiran + peristiwa 'created' dalam SATU transaksi — nomor tiket dibuat trigger database
 * (dtic_assign_ticket_number), aman terhadap pengajuan bersamaan (pola identik order_number). `ticketId`
 * DIBUAT DI PEMANGGIL (bukan default gen_random_uuid() di sini) — path penyimpanan lampiran harus memakai
 * ID ASLI tiket ini (pola identik submitOrder: orderId dibuat dulu supaya buildStoragePath konsisten).
 */
export async function insertFeedbackTicket(ticketId: string, input: FeedbackTicketInput, reporter: FeedbackReporter, attachments: NewFeedbackAttachment[]): Promise<{ id: string; ticketNumber: string }> {
  return sql().begin(async (tx) => {
    const [row] = await tx<{ id: string; ticket_number: string }[]>`
      insert into feedback_tickets (id, kind, title, related_page, detail, impact, related_order_id, reporter_user_id, reporter_name, reporter_contact)
      values (${ticketId}, ${input.kind}, ${input.title}, ${input.relatedPage}, ${input.detail}, ${input.impact}, ${input.relatedOrderId}, ${reporter.userId}, ${reporter.name}, ${reporter.contact})
      returning id, ticket_number`;
    for (const a of attachments) {
      await tx`insert into feedback_attachments (ticket_id, file_name, storage_path, mime_type, file_size) values (${row.id}, ${a.fileName}, ${a.storagePath}, ${a.mimeType}, ${a.fileSize})`;
    }
    await tx`insert into feedback_ticket_events (ticket_id, kind, actor_user_id, actor_name, visible_to_reporter, detail)
      values (${row.id}, 'created', ${reporter.userId}, ${reporter.name}, true, ${tx.json({ attachmentCount: attachments.length })})`;
    // Tiket & antrean notifikasi SELALU konsisten (satu transaksi) — kegagalan kirim Telegram nanti (worker,
    // di luar transaksi ini) tidak pernah bisa membatalkan tiket yang sudah tersimpan.
    await enqueueFeedbackNotification(tx, row.id);
    return { id: row.id, ticketNumber: row.ticket_number };
  });
}

export type FeedbackTicketRow = {
  id: string;
  ticketNumber: string;
  kind: FeedbackKind;
  title: string;
  relatedPage: FeedbackPage;
  detail: string;
  impact: FeedbackImpact | null;
  relatedOrderId: string | null;
  relatedOrderNumber: string | null;
  reporterUserId: string | null;
  reporterName: string;
  reporterContact: string | null;
  status: FeedbackStatus;
  priority: FeedbackPriority | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  resolutionSummary: string | null;
  closeReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type TicketSelectRow = {
  id: string; ticket_number: string; kind: FeedbackKind; title: string; related_page: FeedbackPage; detail: string;
  impact: FeedbackImpact | null; related_order_id: string | null; related_order_number: string | null;
  reporter_user_id: string | null; reporter_name: string; reporter_contact: string | null;
  status: FeedbackStatus; priority: FeedbackPriority | null; assignee_user_id: string | null; assignee_name: string | null;
  resolution_summary: string | null; close_reason: string | null; created_at: Date; updated_at: Date;
};

function toTicketRow(r: TicketSelectRow): FeedbackTicketRow {
  return {
    id: r.id,
    ticketNumber: r.ticket_number,
    kind: r.kind,
    title: r.title,
    relatedPage: r.related_page,
    detail: r.detail,
    impact: r.impact,
    relatedOrderId: r.related_order_id,
    relatedOrderNumber: r.related_order_number,
    reporterUserId: r.reporter_user_id,
    reporterName: r.reporter_name,
    reporterContact: r.reporter_contact,
    status: r.status,
    priority: r.priority,
    assigneeUserId: r.assignee_user_id,
    assigneeName: r.assignee_name,
    resolutionSummary: r.resolution_summary,
    closeReason: r.close_reason,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const ticketColumns = (db: ReturnType<typeof sql>) => db`
  t.id, t.ticket_number, t.kind, t.title, t.related_page, t.detail, t.impact, t.related_order_id,
  o.order_number as related_order_number, t.reporter_user_id, t.reporter_name, t.reporter_contact,
  t.status, t.priority, t.assignee_user_id, au.full_name as assignee_name,
  t.resolution_summary, t.close_reason, t.created_at, t.updated_at`;
const ticketFrom = (db: ReturnType<typeof sql>) => db`
  feedback_tickets t
  left join orders o on o.id = t.related_order_id
  left join app_users au on au.id = t.assignee_user_id`;

export type FeedbackListFilters = {
  q?: string;
  kind?: FeedbackKind;
  status?: FeedbackStatus;
  impact?: FeedbackImpact;
  reporterUserId?: string;
  page: number;
  pageSize: number;
};

export async function listFeedbackTickets(filters: FeedbackListFilters): Promise<{ rows: FeedbackTicketRow[]; total: number }> {
  const db = sql();
  const q = filters.q?.trim();
  const where = db`
    where true
    ${q ? db`and (t.ticket_number ilike ${`%${q}%`} or t.title ilike ${`%${q}%`} or o.order_number ilike ${`%${q}%`})` : db``}
    ${filters.kind ? db`and t.kind = ${filters.kind}` : db``}
    ${filters.status ? db`and t.status = ${filters.status}` : db``}
    ${filters.impact ? db`and t.impact = ${filters.impact}` : db``}
    ${filters.reporterUserId ? db`and t.reporter_user_id = ${filters.reporterUserId}` : db``}`;
  const [rows, [{ total }]] = await Promise.all([
    db<TicketSelectRow[]>`select ${ticketColumns(db)} from ${ticketFrom(db)} ${where} order by t.created_at desc limit ${filters.pageSize} offset ${(filters.page - 1) * filters.pageSize}`,
    db<{ total: number }[]>`select count(*)::int as total from ${ticketFrom(db)} ${where}`,
  ]);
  return { rows: rows.map(toTicketRow), total };
}

export async function getFeedbackSummary(): Promise<{ total: number; new: number; inProgress: number; needInfo: number; done: number }> {
  const [row] = await sql()<{ total: number; new: number; in_progress: number; need_info: number; done: number }[]>`
    select count(*)::int as total,
           count(*) filter (where status = 'new')::int as new,
           count(*) filter (where status = 'in_progress')::int as in_progress,
           count(*) filter (where status = 'need_info')::int as need_info,
           count(*) filter (where status = 'done')::int as done
    from feedback_tickets`;
  return { total: row.total, new: row.new, inProgress: row.in_progress, needInfo: row.need_info, done: row.done };
}

export async function getFeedbackTicketById(id: string): Promise<FeedbackTicketRow | null> {
  const db = sql();
  const rows = await db<TicketSelectRow[]>`select ${ticketColumns(db)} from ${ticketFrom(db)} where t.id = ${id}`;
  return rows[0] ? toTicketRow(rows[0]) : null;
}

export async function getFeedbackTicketByNumber(ticketNumber: string): Promise<FeedbackTicketRow | null> {
  const db = sql();
  const rows = await db<TicketSelectRow[]>`select ${ticketColumns(db)} from ${ticketFrom(db)} where t.ticket_number = ${ticketNumber}`;
  return rows[0] ? toTicketRow(rows[0]) : null;
}

export type FeedbackAttachmentRow = { id: string; fileName: string; mimeType: string; fileSize: number };

export async function listFeedbackAttachments(ticketId: string): Promise<FeedbackAttachmentRow[]> {
  const rows = await sql()<{ id: string; file_name: string; mime_type: string; file_size: number }[]>`
    select id, file_name, mime_type, file_size from feedback_attachments where ticket_id = ${ticketId} order by created_at`;
  return rows.map((r) => ({ id: r.id, fileName: r.file_name, mimeType: r.mime_type, fileSize: Number(r.file_size) }));
}

export async function getFeedbackAttachment(id: string): Promise<{ id: string; ticketId: string; fileName: string; storagePath: string; mimeType: string; fileSize: number } | null> {
  const rows = await sql()<{ id: string; ticket_id: string; file_name: string; storage_path: string; mime_type: string; file_size: number }[]>`
    select id, ticket_id, file_name, storage_path, mime_type, file_size from feedback_attachments where id = ${id}`;
  const r = rows[0];
  return r ? { id: r.id, ticketId: r.ticket_id, fileName: r.file_name, storagePath: r.storage_path, mimeType: r.mime_type, fileSize: Number(r.file_size) } : null;
}

export type FeedbackEventRow = {
  id: string;
  kind: string;
  actorName: string | null;
  visibleToReporter: boolean;
  message: string | null;
  detail: Record<string, unknown>;
  at: string;
};

export async function listFeedbackEvents(ticketId: string, opts: { onlyVisibleToReporter?: boolean } = {}): Promise<FeedbackEventRow[]> {
  const db = sql();
  const rows = await db<{ id: string; kind: string; actor_name: string | null; visible_to_reporter: boolean; message: string | null; detail: Record<string, unknown>; created_at: Date }[]>`
    select id, kind, actor_name, visible_to_reporter, message, detail, created_at from feedback_ticket_events
    where ticket_id = ${ticketId} ${opts.onlyVisibleToReporter ? db`and visible_to_reporter = true` : db``}
    order by created_at asc, id asc`;
  return rows.map((r) => ({ id: r.id, kind: r.kind, actorName: r.actor_name, visibleToReporter: r.visible_to_reporter, message: r.message, detail: r.detail ?? {}, at: r.created_at.toISOString() }));
}

async function assertTicketExists(tx: postgres.TransactionSql, id: string): Promise<void> {
  const rows = await tx`select 1 from feedback_tickets where id = ${id}`;
  if (rows.length === 0) throw new NotFoundError("Tiket tidak ditemukan.");
}

/**
 * Ubah status tindak lanjut — TERPISAH TOTAL dari status pekerjaan/QC order terkait (relatedOrderId hanya
 * tautan, tidak pernah ditulis). 'wont_fix' wajib alasan (ditegakkan juga oleh CHECK di database);
 * 'need_info' mencatat pertanyaan sebagai peristiwa TERSENDIRI yang terlihat pelapor.
 */
export async function updateFeedbackStatus(id: string, status: FeedbackStatus, input: { message?: string; closeReason?: string; resolutionSummary?: string }, actor: FeedbackActor): Promise<void> {
  if (status === "wont_fix" && !input.closeReason?.trim()) throw new AppError("Alasan wajib diisi untuk status Tidak Ditindaklanjuti.", 422, { closeReason: "Alasan wajib diisi." });
  if (status === "need_info" && !input.message?.trim()) throw new AppError("Tulis pertanyaan yang perlu dijawab pelapor.", 422, { message: "Pertanyaan wajib diisi." });
  await sql().begin(async (tx) => {
    await assertTicketExists(tx, id);
    await tx`update feedback_tickets set status = ${status},
        close_reason = ${status === "wont_fix" ? (input.closeReason?.trim() ?? null) : tx`close_reason`},
        resolution_summary = ${status === "done" && input.resolutionSummary?.trim() ? input.resolutionSummary.trim() : tx`resolution_summary`}
      where id = ${id}`;
    await tx`insert into feedback_ticket_events (ticket_id, kind, actor_user_id, actor_name, visible_to_reporter, message, detail)
      values (${id}, ${status === "wont_fix" ? "wont_fix" : status === "done" ? "resolved" : status === "need_info" ? "info_requested" : "status_changed"},
              ${actor.userId}, ${actor.name}, true, ${input.message?.trim() ?? (status === "wont_fix" ? input.closeReason?.trim() : status === "done" ? input.resolutionSummary?.trim() : null) ?? null},
              ${tx.json({ status })})`;
  });
}

export async function updateFeedbackPriority(id: string, priority: FeedbackPriority | null, actor: FeedbackActor): Promise<void> {
  await sql().begin(async (tx) => {
    await assertTicketExists(tx, id);
    await tx`update feedback_tickets set priority = ${priority} where id = ${id}`;
    await tx`insert into feedback_ticket_events (ticket_id, kind, actor_user_id, actor_name, visible_to_reporter, detail)
      values (${id}, 'priority_changed', ${actor.userId}, ${actor.name}, false, ${tx.json({ priority })})`;
  });
}

export async function updateFeedbackAssignee(id: string, assigneeUserId: string | null, assigneeName: string | null, actor: FeedbackActor): Promise<void> {
  await sql().begin(async (tx) => {
    await assertTicketExists(tx, id);
    await tx`update feedback_tickets set assignee_user_id = ${assigneeUserId} where id = ${id}`;
    await tx`insert into feedback_ticket_events (ticket_id, kind, actor_user_id, actor_name, visible_to_reporter, detail)
      values (${id}, 'assignee_changed', ${actor.userId}, ${actor.name}, false, ${tx.json({ assigneeUserId, assigneeName })})`;
  });
}

/** Catatan internal Super Admin — TIDAK PERNAH terlihat pelapor (lihat visible_to_reporter). */
export async function addFeedbackNote(id: string, message: string, actor: FeedbackActor): Promise<void> {
  await sql().begin(async (tx) => {
    await assertTicketExists(tx, id);
    await tx`insert into feedback_ticket_events (ticket_id, kind, actor_user_id, actor_name, visible_to_reporter, message)
      values (${id}, 'note_added', ${actor.userId}, ${actor.name}, false, ${message})`;
  });
}

/**
 * Pelapor menjawab pertanyaan ('Menunggu Informasi') lewat pencarian tiket publik — tidak ada sesi, murni
 * berdasar nomor tiket (sama seperti model kepercayaan Riwayat Request). Status kembali ke 'reviewed'
 * supaya Super Admin tahu ada balasan baru untuk diperiksa.
 */
export async function addFeedbackReply(ticketNumber: string, message: string): Promise<void> {
  await sql().begin(async (tx) => {
    const [t] = await tx<{ id: string; status: FeedbackStatus }[]>`select id, status from feedback_tickets where ticket_number = ${ticketNumber}`;
    if (!t) throw new NotFoundError("Tiket tidak ditemukan.");
    if (t.status !== "need_info") throw new AppError("Tiket ini tidak sedang menunggu informasi tambahan.", 409);
    await tx`update feedback_tickets set status = 'reviewed' where id = ${t.id}`;
    await tx`insert into feedback_ticket_events (ticket_id, kind, visible_to_reporter, message)
      values (${t.id}, 'info_provided', true, ${message})`;
  });
}

export async function listInternalAssignees(): Promise<{ id: string; fullName: string }[]> {
  const rows = await sql()<{ id: string; full_name: string }[]>`
    select id, full_name from app_users where is_active and role in ('super_admin', 'manager') order by full_name`;
  return rows.map((r) => ({ id: r.id, fullName: r.full_name }));
}
