import "server-only";
import type postgres from "postgres";
import { sql } from "@/lib/server/db";
import type { HistoryStatus, OrderStatus } from "@/lib/status";
import type { TelegramStatus } from "@/lib/member-telegram";
import { chooseDestination, EVENT_FLAG, SKIP_REASON, type GroupState, type TelegramEventType } from "@/lib/telegram-routing";

export type OutboxStatus = "pending" | "processing" | "retrying" | "sent" | "failed" | "skipped" | "awaiting_destination";
export type OutboxKind = "order_created" | "status_changed" | "pic_changed";
export type ErrorKind = "transient" | "permanent";
type Tx = postgres.TransactionSql;

/** Kunci sewa: proses yang macet di "processing" lebih dari ini boleh diambil ulang. */
const LEASE_SECONDS = 120;

/** Baris yang sudah diklaim untuk dikirim (status sudah menjadi processing, attempts sudah ditambah). */
export type ClaimedOutbox = {
  id: string;
  kind: OutboxKind;
  order_id: string;
  event_ref: string;
  attempts: number;
  max_attempts: number;
  /** Tujuan yang dicatat saat antrean dibuat (snapshot). Dipakai untuk mengirim, bukan konfigurasi env. */
  chat_id: string;
  config_id: string;
};

/**
 * Klaim satu baris untuk dikirim sekarang (percobaan langsung setelah pengajuan / kirim ulang manual).
 * Atomik: hanya satu proses yang berhasil. Null = tidak perlu / sedang diproses / sudah habis.
 */
export async function claimOutboxById(id: string): Promise<ClaimedOutbox | null> {
  const rows = await sql()<ClaimedOutbox[]>`
    update notification_outbox set status = 'processing', attempts = attempts + 1, locked_at = now()
    where id = ${id} and channel = 'telegram' and attempts < max_attempts and chat_id is not null and config_id is not null
      and ((status in ('pending', 'retrying') and next_attempt_at <= now())
           or (status = 'processing' and locked_at < now() - make_interval(secs => ${LEASE_SECONDS})))
    returning id, kind, order_id, event_ref, attempts, max_attempts, chat_id, config_id`;
  return rows[0] ?? null;
}

/**
 * Worker: ambil sampai `limit` baris yang sudah jatuh tempo. `FOR UPDATE SKIP LOCKED` memastikan dua worker
 * tidak pernah mengambil baris yang sama bersamaan; status 'processing' + lease melindungi dari worker macet.
 */
export async function claimDueOutbox(limit: number): Promise<ClaimedOutbox[]> {
  return sql()<ClaimedOutbox[]>`
    update notification_outbox set status = 'processing', attempts = attempts + 1, locked_at = now()
    where id in (
      select id from notification_outbox
      where channel = 'telegram' and attempts < max_attempts and chat_id is not null and config_id is not null
        and ((status in ('pending', 'retrying') and next_attempt_at <= now())
             or (status = 'processing' and locked_at < now() - make_interval(secs => ${LEASE_SECONDS})))
      order by next_attempt_at, created_at
      limit ${limit}
      for update skip locked)
    returning id, kind, order_id, event_ref, attempts, max_attempts, chat_id, config_id`;
}

/** Semua tujuan notifikasi pengajuan baru untuk satu order: grup brand ('') dan cadangan default. */
export async function newOrderOutboxRows(orderId: string): Promise<{ id: string; status: OutboxStatus; last_error: string | null }[]> {
  return sql()<{ id: string; status: OutboxStatus; last_error: string | null }[]>`
    select id, status, last_error from notification_outbox
    where channel = 'telegram' and kind = 'order_created' and order_id = ${orderId} and event_ref = ''`;
}

/**
 * Antrean kirim ulang manual. Kunci idempoten dari klien menjadi event_ref: klik ganda atau retry jaringan
 * dengan kunci yang sama tidak membuat antrean kedua. Mengembalikan id dan apakah baris baru dibuat.
 */
export async function upsertManualOutbox(orderId: string, key: string): Promise<{ id: string; created: boolean }> {
  const eventRef = `manual:${key}`;
  return sql().begin(async (tx) => {
    const inserted = await enqueueOrderNotification(tx, { orderId, kind: "order_created", eventType: "new_order", eventRef });
    if (inserted) return { id: inserted, created: true };
    const [existing] = await tx<{ id: string }[]>`
      select id from notification_outbox where channel = 'telegram' and kind = 'order_created' and order_id = ${orderId} and event_ref = ${eventRef}`;
    return { id: existing.id, created: false };
  });
}

export type NotificationRoute = {
  status: "pending" | "skipped" | "awaiting_destination";
  /** Brand order: hanya untuk riwayat & isi pesan, TIDAK menentukan tujuan. */
  brandId: string | null;
  configId: string | null;
  chatId: string | null;
  reason: string | null;
  /** "global" bila dikirim ke grup global; null bila belum ada tujuan. */
  destination: "global" | null;
};

type GroupRow = {
  id: string; chat_id: string; is_active: boolean; verification_status: string;
  notify_new_order: boolean; notify_status_changed: boolean; notify_waiting_confirmation: boolean;
  notify_completed: boolean; notify_on_hold: boolean; notify_cancelled: boolean; notify_pic_changed: boolean;
};

function groupState(g: GroupRow | undefined, eventType: TelegramEventType): GroupState {
  if (!g) return "no_channel";
  if (g.verification_status !== "verified") return "unverified";
  if (!g.is_active) return "inactive";
  return g[EVENT_FLAG[eventType]] ? "ok" : "event_disabled";
}

/**
 * Tujuan notifikasi: SATU grup Telegram global untuk semua brand (baris tanpa brand). Brand tidak dipakai untuk
 * memilih tujuan, hanya dicatat dan dicantumkan di pesan. Tidak pernah memakai grup lain atau chat yang tidak terverifikasi.
 */
export async function routeOrderNotification(tx: Tx, orderId: string, eventType: TelegramEventType): Promise<NotificationRoute> {
  const [order] = await tx<{ brand_id: string | null }[]>`select brand_id from orders where id = ${orderId}`;
  const brandId = order?.brand_id ?? null;
  const [group] = await tx<GroupRow[]>`
    select id, chat_id, is_active, verification_status, notify_new_order, notify_status_changed,
           notify_waiting_confirmation, notify_completed, notify_on_hold, notify_cancelled, notify_pic_changed
    from telegram_brand_channels where brand_id is null`;
  const state = groupState(group, eventType);
  const choice = chooseDestination({ group: state, eventType });
  if (choice === "send") return { status: "pending", brandId, configId: group!.id, chatId: group!.chat_id, reason: null, destination: "global" };
  if (choice === "skip") {
    const reason = state === "event_disabled" ? SKIP_REASON.event_disabled : SKIP_REASON.no_destination;
    return { status: "skipped", brandId, configId: group?.id ?? null, chatId: null, reason, destination: null };
  }
  return { status: "awaiting_destination", brandId, configId: null, chatId: null, reason: SKIP_REASON.no_destination, destination: null };
}

/** Tujuan pengajuan baru untuk satu order SAAT INI (pratinjau, tes, kirim ulang). Aturan sama dengan antrean. */
export async function resolveOrderDestination(orderId: string): Promise<NotificationRoute> {
  return sql().begin((tx) => routeOrderNotification(tx, orderId, "new_order"));
}

/** Event pengajuan baru order ini yang masih menunggu tujuan (agar kirim ulang tidak membuat antrean ganda). */
export async function awaitingNewOrderRow(orderId: string): Promise<string | null> {
  const [r] = await sql()<{ id: string }[]>`
    select id from notification_outbox
    where channel = 'telegram' and kind = 'order_created' and order_id = ${orderId} and status = 'awaiting_destination'
    order by created_at limit 1`;
  return r?.id ?? null;
}

/**
 * Buat satu antrean notifikasi di dalam transaksi yang sama dengan perubahan data. Mengembalikan id
 * baris baru (null bila sudah ada: idempoten). Tujuan yang tidak valid tetap dicatat sebagai 'skipped'.
 */
export async function enqueueOrderNotification(
  tx: Tx,
  input: { orderId: string; kind: OutboxKind; eventType: TelegramEventType; eventRef: string },
): Promise<string | null> {
  const route = await routeOrderNotification(tx, input.orderId, input.eventType);
  const [row] = await tx<{ id: string }[]>`
    insert into notification_outbox (channel, kind, order_id, event_ref, event_type, brand_id, config_id, chat_id, status, last_error)
    values ('telegram', ${input.kind}, ${input.orderId}, ${input.eventRef}, ${input.eventType}, ${route.brandId}, ${route.configId},
            ${route.chatId}, ${route.status}, ${route.reason})
    on conflict (channel, kind, order_id, event_ref) do nothing
    returning id`;
  return row?.id ?? null;
}

/** Keadaan saluran saat ini: dipakai sebelum mengirim untuk memastikan grup masih aktif dan tidak berubah. */
export async function currentChannel(configId: string): Promise<{ isActive: boolean; verified: boolean; chatId: string; threadId: number | null; isDefault: boolean } | null> {
  const [r] = await sql()<{ is_active: boolean; chat_id: string; message_thread_id: number | null; verification_status: string; brand_id: string | null }[]>`
    select is_active, chat_id, message_thread_id, verification_status, brand_id from telegram_brand_channels where id = ${configId}`;
  return r
    ? { isActive: r.is_active, verified: r.verification_status === "verified", chatId: r.chat_id, threadId: r.message_thread_id, isDefault: r.brand_id === null }
    : null;
}

/**
 * Pindahkan event yang "menunggu tujuan" ke antrean kirim bila kini ada grup tujuan aktif. Tidak membuat event
 * atau pengajuan baru, dan hanya menyentuh baris yang belum pernah terkirim. Aman dijalankan berulang/bersamaan.
 */
export async function rerouteAwaitingDestination(limit = 50): Promise<number> {
  return sql().begin(async (tx) => {
    // Hanya diambil bila grup global KINI aktif; tanpa grup aktif, worker tidak memindai baris yang sama setiap tick.
    const rows = await tx<{ id: string; order_id: string; event_type: TelegramEventType | null }[]>`
      select n.id, n.order_id, n.event_type from notification_outbox n
      where n.channel = 'telegram' and n.status = 'awaiting_destination'
        and exists (
          select 1 from telegram_brand_channels c
          where c.brand_id is null and c.is_active and c.verification_status = 'verified' and c.notify_new_order)
      order by n.created_at limit ${limit}
      for update of n skip locked`;
    let moved = 0;
    for (const r of rows) {
      const route = await routeOrderNotification(tx, r.order_id, r.event_type ?? "new_order");
      if (route.status !== "pending") continue;
      await tx`
        update notification_outbox set status = 'pending', config_id = ${route.configId}, chat_id = ${route.chatId},
          brand_id = ${route.brandId}, last_error = null, error_kind = null, error_code = null, next_attempt_at = now()
        where id = ${r.id} and status = 'awaiting_destination'`;
      moved++;
    }
    return moved;
  });
}

/** Jumlah event yang menunggu tujuan (diagnostik worker). */
export async function countAwaitingDestination(): Promise<number> {
  const [r] = await sql()<{ n: number }[]>`select count(*)::int as n from notification_outbox where channel = 'telegram' and status = 'awaiting_destination'`;
  return r?.n ?? 0;
}

/** max_attempts bawaan baris baru (lihat kolom di migrasi 20261013070000_telegram_retry.sql). */
const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Pulihkan baris yang GAGAL PERMANEN karena galat SEMENTARA (timeout/jaringan/5xx/429) setelah seluruh
 * jadwal retry (~2,4 menit) habis — bukan galat permanen (token/chat salah), yang tetap tidak diulang.
 * Dipanggil worker secara berkala (lihat telegram-worker.ts) sebagai jaring pengaman untuk outage Telegram
 * yang berlangsung LEBIH LAMA dari jendela retry normal, supaya tidak bergantung pada Super Admin sadar dan
 * menekan "Kirim ulang" secara manual.
 *
 * Dibatasi TEPAT SATU KALI per baris (bukan retry tanpa batas): hanya baris yang max_attempts-nya masih nilai
 * bawaan (belum pernah dipulihkan sebelumnya) yang memenuhi syarat — begitu dipulihkan, max_attempts naik
 * permanen, sehingga baris yang sama tidak pernah dipulihkan untuk kedua kalinya. Tidak membuat baris baru
 * (tanpa duplikasi) — hanya baris yang sudah ada yang mendapat satu kesempatan tambahan lewat jalur
 * klaim/kirim yang sudah ada (claimDueOutbox), bukan jalur baru.
 */
export async function reviveStaleFailedOutbox(cooldownMinutes: number): Promise<number> {
  const rows = await sql()<{ id: string }[]>`
    update notification_outbox
    set max_attempts = max_attempts + 1, status = 'pending', next_attempt_at = now(), locked_at = null
    where channel = 'telegram' and status = 'failed' and error_kind = 'transient'
      and max_attempts = ${DEFAULT_MAX_ATTEMPTS} and updated_at < now() - make_interval(mins => ${cooldownMinutes})
    returning id`;
  return rows.length;
}

/** Dilewati dengan alasan tercatat (tidak ada percobaan kirim). Alasan harus aman: tanpa token/chat ID. */
export async function markOutboxSkipped(id: string, reason: string) {
  await sql()`update notification_outbox set status = 'skipped', last_error = ${reason.slice(0, 300)}, error_kind = null, locked_at = null where id = ${id}`;
}

export type OutboxState = { status: OutboxStatus; lastError: string | null; attempts: number; maxAttempts: number; nextAttemptAt: string; errorKind: ErrorKind | null; sentAt: string | null };

export async function outboxStateById(id: string): Promise<OutboxState | null> {
  const [r] = await sql()<{ status: OutboxStatus; last_error: string | null; attempts: number; max_attempts: number; next_attempt_at: Date; error_kind: ErrorKind | null; sent_at: Date | null }[]>`
    select status, last_error, attempts, max_attempts, next_attempt_at, error_kind, sent_at from notification_outbox where id = ${id}`;
  if (!r) return null;
  return {
    status: r.status,
    lastError: r.last_error,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    nextAttemptAt: r.next_attempt_at.toISOString(),
    errorKind: r.error_kind,
    sentAt: r.sent_at?.toISOString() ?? null,
  };
}

export async function markOutboxSent(id: string) {
  await sql()`update notification_outbox set status = 'sent', sent_at = now(), last_error = null, error_kind = null, error_code = null, locked_at = null where id = ${id}`;
}

/** Gagal sementara: dijadwalkan ulang. `message` harus sudah aman (tanpa token, URL, atau isi pesan). */
export async function markOutboxRetrying(id: string, delaySeconds: number, message: string, errorCode: number | null = null) {
  await sql()`
    update notification_outbox set status = 'retrying', next_attempt_at = now() + make_interval(secs => ${delaySeconds}),
      last_error = ${message.slice(0, 300)}, error_kind = 'transient', error_code = ${errorCode}, locked_at = null
    where id = ${id}`;
}

/** Gagal permanen atau percobaan habis. */
export async function markOutboxFailed(id: string, message: string, kind: ErrorKind, errorCode: number | null = null) {
  await sql()`update notification_outbox set status = 'failed', last_error = ${message.slice(0, 300)}, error_kind = ${kind}, error_code = ${errorCode}, locked_at = null where id = ${id}`;
}

/**
 * Jadwalkan ulang satu notifikasi untuk order yang sama (aksi Super Admin). Baris yang gagal permanen atau
 * habis dimulai ulang dari percobaan pertama (tercatat di audit oleh pemanggil); baris lain segera jatuh tempo.
 */
export async function rescheduleOutbox(id: string): Promise<boolean> {
  const rows = await sql()<{ id: string }[]>`
    update notification_outbox set
      status = 'pending',
      attempts = case when status = 'failed' then 0 else attempts end,
      next_attempt_at = now(), error_kind = null
    where id = ${id} and channel = 'telegram' and status in ('pending', 'retrying', 'failed')
    returning id`;
  return rows.length > 0;
}

/** Jadwalkan ulang semua notifikasi yang belum terkirim (maks. `limit`). Mengembalikan jumlah yang dijadwalkan. */
export async function rescheduleAllUnsent(limit: number): Promise<number> {
  const rows = await sql()<{ id: string }[]>`
    update notification_outbox set
      status = 'pending',
      attempts = case when status = 'failed' then 0 else attempts end,
      next_attempt_at = now(), error_kind = null
    where id in (
      select id from notification_outbox
      where channel = 'telegram' and status in ('pending', 'retrying', 'failed')
      order by created_at limit ${limit})
    returning id`;
  return rows.length;
}

export type OutboxSummary = {
  pending: number;
  processing: number;
  retrying: number;
  failed: number;
  skipped: number;
  awaiting: number;
  sent: number;
  lastSentAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  recent: { id: string; orderNumber: string; kind: OutboxKind; status: OutboxStatus; attempts: number; maxAttempts: number; nextAttemptAt: string; errorKind: ErrorKind | null; lastError: string | null; updatedAt: string }[];
};

export async function telegramOutboxSummary(): Promise<OutboxSummary> {
  const counts = await sql()<{ status: OutboxStatus; n: number }[]>`
    select status, count(*)::int as n from notification_outbox where channel = 'telegram' group by status`;
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  const last = await sql()<{ sent_at: Date | null; failed_at: Date | null; last_error: string | null }[]>`
    select max(sent_at) as sent_at,
           max(updated_at) filter (where status = 'failed') as failed_at,
           (select last_error from notification_outbox where channel = 'telegram' and status in ('failed', 'retrying') order by updated_at desc limit 1) as last_error
    from notification_outbox where channel = 'telegram'`;
  const recent = await sql()<{ id: string; order_number: string; kind: OutboxKind; status: OutboxStatus; attempts: number; max_attempts: number; next_attempt_at: Date; error_kind: ErrorKind | null; last_error: string | null; updated_at: Date }[]>`
    select n.id, o.order_number, n.kind, n.status, n.attempts, n.max_attempts, n.next_attempt_at, n.error_kind, n.last_error, n.updated_at
    from notification_outbox n join orders o on o.id = n.order_id
    where n.channel = 'telegram'
    order by n.updated_at desc limit 15`;
  return {
    pending: byStatus.pending ?? 0,
    processing: byStatus.processing ?? 0,
    retrying: byStatus.retrying ?? 0,
    failed: byStatus.failed ?? 0,
    skipped: byStatus.skipped ?? 0,
    awaiting: byStatus.awaiting_destination ?? 0,
    sent: byStatus.sent ?? 0,
    lastSentAt: last[0]?.sent_at?.toISOString() ?? null,
    lastFailedAt: last[0]?.failed_at?.toISOString() ?? null,
    lastError: last[0]?.last_error ?? null,
    recent: recent.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      kind: r.kind,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      nextAttemptAt: r.next_attempt_at.toISOString(),
      errorKind: r.error_kind,
      lastError: r.last_error,
      updatedAt: r.updated_at.toISOString(),
    })),
  };
}

/** PIC order beserta identitas Telegram anggota (dari menu Member DTIC). */
export type PicInfo = { fullName: string; displayName: string | null; username: string | null; userId: string | null; status: TelegramStatus };

type PicInfoRow = { full_name: string; telegram_display_name: string | null; telegram_username: string | null; telegram_user_id: string | null; telegram_status: TelegramStatus };
const toPicInfo = (r: PicInfoRow): PicInfo => ({
  fullName: r.full_name,
  displayName: r.telegram_display_name,
  username: r.telegram_username,
  userId: r.telegram_user_id,
  status: r.telegram_status,
});

/** Identitas Telegram anggota tertentu (untuk mention anggota yang terdampak perubahan PIC). */
async function picInfosForMembers(memberIds: string[]): Promise<PicInfo[]> {
  if (memberIds.length === 0) return [];
  const db = sql();
  const rows = await db<PicInfoRow[]>`
    select full_name, telegram_display_name, telegram_username, telegram_user_id, telegram_status
    from dtic_members where id in ${db(memberIds)} order by full_name`;
  return rows.map(toPicInfo);
}

/** Data pesan perubahan PIC: snapshot dari baris audit yang dirujuk outbox (event_ref), bukan keadaan PIC terkini. */
export type PicChangeData = {
  orderId: string;
  orderNumber: string;
  title: string;
  operation: "add" | "remove" | "replace" | "move" | null;
  teamName: string | null;
  before: string[];
  after: string[];
  added: PicInfo[];
  removed: string[];
  reason: string | null;
  actorName: string | null;
  changedAt: Date;
};

export async function getPicChangeData(orderId: string, auditId: string): Promise<PicChangeData | null> {
  if (!/^\d{1,18}$/.test(auditId)) return null;
  const [r] = await sql()<
    { detail: { before?: string[]; after?: string[]; removed?: string[]; addedIds?: string[]; reason?: string | null; title?: string; operation?: PicChangeData["operation"]; actorName?: string }; created_at: Date; actor_name: string | null; order_number: string; title: string; team_name: string | null }[]
  >`
    select l.detail, l.created_at, u.full_name as actor_name, o.order_number, o.title, t.name as team_name
    from auth_audit_log l
    join orders o on o.id = ${orderId}
    left join app_users u on u.id = l.actor_user_id
    left join dtic_teams t on t.id = o.team_id
    where l.id = ${auditId}::bigint and l.action = 'order_pic_changed' and l.detail->>'orderId' = ${orderId}`;
  if (!r) return null;
  return {
    orderId,
    orderNumber: r.order_number,
    // Snapshot saat perubahan; nama pelaku dari session yang tercatat di audit (cadangan: akun pelaku).
    title: r.detail.title ?? r.title,
    operation: r.detail.operation ?? null,
    teamName: r.team_name,
    before: r.detail.before ?? [],
    after: r.detail.after ?? [],
    added: await picInfosForMembers(r.detail.addedIds ?? []),
    removed: r.detail.removed ?? [],
    reason: r.detail.reason ?? null,
    actorName: r.detail.actorName ?? r.actor_name,
    changedAt: r.created_at,
  };
}

async function picInfosOf(orderId: string): Promise<PicInfo[]> {
  const rows = await sql()<{ full_name: string; telegram_display_name: string | null; telegram_username: string | null; telegram_user_id: string | null; telegram_status: TelegramStatus }[]>`
    select m.full_name, m.telegram_display_name, m.telegram_username, m.telegram_user_id, m.telegram_status
    from order_assignments a join dtic_members m on m.id = a.member_id
    where a.order_id = ${orderId} order by a.assigned_at, m.full_name`;
  return rows.map((r) => ({
    fullName: r.full_name,
    displayName: r.telegram_display_name,
    username: r.telegram_username,
    userId: r.telegram_user_id,
    status: r.telegram_status,
  }));
}

/** Data pesan pengajuan baru, dibaca dari database setelah penyimpanan (bukan dari input mentah). */
export type OrderNotificationData = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  createdAt: Date;
  requesterName: string;
  department: string;
  brandName: string;
  teamName: string | null;
  designType: string;
  title: string;
  brief: string;
  priorityName: string | null;
  deadlineAt: Date;
  attachmentCount: number;
  picInfos: PicInfo[];
};

export async function getOrderNotificationData(orderId: string): Promise<OrderNotificationData | null> {
  const [r] = await sql()<
    {
      id: string; order_number: string; status: OrderStatus; created_at: Date; requester_name: string; brand_name: string; team_name: string | null;
      department: string; design_type: string; title: string; brief: string; priority_name: string | null; deadline_at: Date; attachment_count: number;
    }[]
  >`
    select o.id, o.order_number, o.status, o.created_at, o.requester_name, b.name as brand_name, tm.name as team_name,
           o.department, o.design_type, o.title, o.brief, p.name as priority_name, o.deadline_at,
           (select count(*)::int from order_attachments a where a.order_id = o.id and a.kind = 'reference') as attachment_count
    from orders o
    join brands b on b.id = o.brand_id
    left join dtic_teams tm on tm.id = o.team_id
    left join priority_levels p on p.code = o.priority
    where o.id = ${orderId}`;
  if (!r) return null;
  return {
    id: r.id,
    orderNumber: r.order_number,
    status: r.status,
    createdAt: r.created_at,
    requesterName: r.requester_name,
    department: r.department,
    brandName: r.brand_name,
    teamName: r.team_name,
    designType: r.design_type,
    title: r.title,
    brief: r.brief,
    priorityName: r.priority_name,
    deadlineAt: r.deadline_at,
    attachmentCount: r.attachment_count,
    picInfos: await picInfosOf(r.id),
  };
}

/** Data pesan perubahan status: diambil dari baris riwayat yang dirujuk outbox (event_ref). */
export type StatusEventData = {
  orderId: string;
  orderNumber: string;
  title: string;
  previousStatus: HistoryStatus | null;
  newStatus: HistoryStatus;
  changedAt: Date;
  note: string | null;
  actorName: string | null;
  picInfos: PicInfo[];
};

export async function getStatusEventData(orderId: string, historyId: string): Promise<StatusEventData | null> {
  const [r] = await sql()<
    { order_id: string; order_number: string; title: string; previous_status: HistoryStatus | null; new_status: HistoryStatus; changed_at: Date; notes: string | null; actor_name: string | null }[]
  >`
    select o.id as order_id, o.order_number, o.title, h.previous_status, h.new_status, h.changed_at, h.notes, u.full_name as actor_name
    from order_status_history h
    join orders o on o.id = h.order_id
    left join app_users u on u.id = h.changed_by
    where h.id = ${historyId} and h.order_id = ${orderId}`;
  if (!r) return null;
  return {
    orderId: r.order_id,
    orderNumber: r.order_number,
    title: r.title,
    previousStatus: r.previous_status,
    newStatus: r.new_status,
    changedAt: r.changed_at,
    note: r.notes,
    actorName: r.actor_name,
    picInfos: await picInfosOf(r.order_id),
  };
}
