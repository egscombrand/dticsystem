import "server-only";
import type postgres from "postgres";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError, pgErrorCode } from "@/lib/server/errors";
import { maskChatId } from "@/lib/telegram-routing";

export type FeedbackVerificationStatus = "unverified" | "verified" | "bot_no_access" | "failed";
export type FeedbackVerifiedChat = { chatId: string; chatTitle: string | null; chatUsername: string | null; sourceLink: string; threadId: number | null };
export type SaveFeedbackResult = { kind: "saved"; created: boolean } | { kind: "replace_required"; currentTitle: string | null };

export type FeedbackChannel = {
  configId: string;
  chatMasked: string;
  chatTitle: string | null;
  chatUsername: string | null;
  sourceLink: string | null;
  topicId: number | null;
  isActive: boolean;
  verificationStatus: FeedbackVerificationStatus;
  verifiedAt: string | null;
  lastTestedAt: string | null;
  lastTestResult: "ok" | "failed" | null;
  lastTestMessage: string | null;
  updatedAt: string;
};

type ChannelRow = {
  id: string; chat_id: string; chat_title: string | null; chat_username: string | null; source_link: string | null;
  message_thread_id: number | null; is_active: boolean; verification_status: FeedbackVerificationStatus; verified_at: Date | null;
  last_tested_at: Date | null; last_test_result: "ok" | "failed" | null; last_test_message: string | null; updated_at: Date;
};

function channelOf(r: ChannelRow): FeedbackChannel {
  return {
    configId: r.id,
    chatMasked: maskChatId(r.chat_id),
    chatTitle: r.chat_title,
    chatUsername: r.chat_username,
    sourceLink: r.source_link,
    topicId: r.message_thread_id,
    isActive: r.is_active,
    verificationStatus: r.verification_status,
    verifiedAt: r.verified_at?.toISOString() ?? null,
    lastTestedAt: r.last_tested_at?.toISOString() ?? null,
    lastTestResult: r.last_test_result,
    lastTestMessage: r.last_test_message,
    updatedAt: r.updated_at.toISOString(),
  };
}

/** Konfigurasi grup Tim IT untuk halaman Integrasi (tanpa chat ID mentah). Null bila belum pernah dihubungkan. */
export async function getFeedbackChannel(): Promise<FeedbackChannel | null> {
  const [r] = await sql()<ChannelRow[]>`select * from feedback_telegram_channel limit 1`;
  return r ? channelOf(r) : null;
}

/** Tujuan kirim SEBENARNYA (chat_id mentah) — dipakai processFeedbackNotifications, bukan UI. */
export async function channelForFeedback(): Promise<{ configId: string; chatId: string; threadId: number | null; isActive: boolean; verificationStatus: FeedbackVerificationStatus } | null> {
  const [r] = await sql()<{ id: string; chat_id: string; message_thread_id: number | null; is_active: boolean; verification_status: FeedbackVerificationStatus }[]>`
    select id, chat_id, message_thread_id, is_active, verification_status from feedback_telegram_channel limit 1`;
  return r ? { configId: r.id, chatId: r.chat_id, threadId: r.message_thread_id, isActive: r.is_active, verificationStatus: r.verification_status } : null;
}

/** Simpan grup yang BARU saja terverifikasi (chat_id berasal dari Telegram Bot API — lihat verifyFeedbackGroup). */
export async function saveFeedbackVerifiedChannel(v: FeedbackVerifiedChat, actorId: string, replace: boolean): Promise<SaveFeedbackResult> {
  try {
    return await sql().begin(async (tx): Promise<SaveFeedbackResult> => {
      const [existing] = await tx<{ id: string; chat_id: string; verification_status: FeedbackVerificationStatus; chat_title: string | null }[]>`
        select id, chat_id, verification_status, chat_title from feedback_telegram_channel limit 1 for update`;
      if (existing) {
        const changed = existing.chat_id !== v.chatId;
        if (changed && existing.verification_status === "verified" && !replace) {
          return { kind: "replace_required", currentTitle: existing.chat_title };
        }
        await tx`
          update feedback_telegram_channel set
            chat_id = ${v.chatId}, chat_title = ${v.chatTitle}, chat_username = ${v.chatUsername}, source_link = ${v.sourceLink},
            message_thread_id = ${v.threadId}, verification_status = 'verified', verified_at = now(),
            is_active = case when ${changed} then false else is_active end,
            last_test_result = case when ${changed} then null else last_test_result end,
            last_test_message = case when ${changed} then null else last_test_message end,
            last_tested_at = case when ${changed} then null else last_tested_at end,
            updated_by = ${actorId}
          where id = ${existing.id}`;
        return { kind: "saved", created: false };
      }
      await tx`
        insert into feedback_telegram_channel (chat_id, chat_title, chat_username, source_link, message_thread_id, verification_status, verified_at, is_active, created_by, updated_by)
        values (${v.chatId}, ${v.chatTitle}, ${v.chatUsername}, ${v.sourceLink}, ${v.threadId}, 'verified', now(), false, ${actorId}, ${actorId})`;
      return { kind: "saved", created: true };
    });
  } catch (error) {
    if (pgErrorCode(error) === "23505") throw new AppError("Grup ini sudah terhubung ke tujuan lain. Satu grup Telegram hanya untuk satu tujuan.", 409, { link: "Grup sudah dipakai tujuan lain." });
    throw error;
  }
}

export async function disconnectFeedbackChannel(): Promise<{ chatTitle: string | null }> {
  const [r] = await sql()`delete from feedback_telegram_channel returning chat_title`;
  if (!r) throw new NotFoundError("Grup Tim IT belum terhubung.");
  return { chatTitle: r.chat_title as string | null };
}

export async function setFeedbackChannelActive(isActive: boolean, actorId: string): Promise<void> {
  const rows = await sql()<{ verification_status: FeedbackVerificationStatus }[]>`
    update feedback_telegram_channel set is_active = case when ${isActive} and verification_status = 'verified' then true else false end, updated_by = ${actorId}
    returning verification_status`;
  if (rows.length === 0) throw new NotFoundError("Grup Tim IT belum diverifikasi.");
  if (isActive && rows[0].verification_status !== "verified") throw new AppError("Verifikasi grup terlebih dahulu sebelum mengaktifkan integrasi.", 409, { isActive: "Belum terverifikasi." });
}

export async function acquireFeedbackTestLock(seconds = 20): Promise<boolean> {
  const rows = await sql()<{ id: string }[]>`
    update feedback_telegram_channel set test_locked_until = now() + make_interval(secs => ${seconds})
    where test_locked_until is null or test_locked_until < now()
    returning id`;
  return rows.length > 0;
}

export async function releaseFeedbackTestLock(): Promise<void> {
  await sql()`update feedback_telegram_channel set test_locked_until = null`;
}

export async function recordFeedbackTestResult(result: { ok: boolean; message: string }): Promise<void> {
  await sql()`update feedback_telegram_channel set last_tested_at = now(), last_test_result = ${result.ok ? "ok" : "failed"}, last_test_message = ${result.message.slice(0, 300)}`;
}

// ---------------------------------------------------------------------------
// Antrean notifikasi tiket (SATU baris per tiket — unique ticket_id mencegah notifikasi ganda).
// ---------------------------------------------------------------------------

/** Dipanggil DI DALAM transaksi pembuatan tiket (lihat insertFeedbackTicket) — tiket & antrean notifikasi
 *  selalu konsisten (tidak pernah ada tiket tanpa baris notifikasi, atau sebaliknya). */
export async function enqueueFeedbackNotification(tx: postgres.TransactionSql, ticketId: string): Promise<void> {
  await tx`insert into feedback_notifications (ticket_id) values (${ticketId})`;
}

export type FeedbackNotificationClaim = { id: string; ticketId: string; attempts: number };

/** Klaim baris jatuh tempo secara ATOMIK (pola identik claimDueOutbox order) — permintaan bersamaan (tick
 *  worker tumpang tindih) tidak pernah mengklaim baris yang sama dua kali. */
export async function claimDueFeedbackNotifications(limit: number): Promise<FeedbackNotificationClaim[]> {
  const LOCK_LEASE_SECONDS = 120;
  const MAX_ATTEMPTS = 8;
  const rows = await sql()<{ id: string; ticket_id: string; attempts: number }[]>`
    update feedback_notifications set status = 'processing', locked_at = now()
    where id in (
      select id from feedback_notifications
      where attempts < ${MAX_ATTEMPTS}
        and (status = 'pending' or (status = 'failed' and attempts < ${MAX_ATTEMPTS}) or (status = 'processing' and locked_at < now() - make_interval(secs => ${LOCK_LEASE_SECONDS})))
      order by created_at
      limit ${limit}
      for update skip locked
    )
    returning id, ticket_id, attempts`;
  return rows.map((r) => ({ id: r.id, ticketId: r.ticket_id, attempts: r.attempts }));
}

export async function markFeedbackNotificationSent(id: string): Promise<void> {
  await sql()`update feedback_notifications set status = 'sent', sent_at = now(), locked_at = null, last_error = null where id = ${id}`;
}

export async function markFeedbackNotificationFailed(id: string, attempts: number, error: string): Promise<void> {
  await sql()`update feedback_notifications set status = 'failed', attempts = ${attempts + 1}, last_error = ${error.slice(0, 300)}, locked_at = null where id = ${id}`;
}

export type FeedbackNotificationStatus = { status: "pending" | "processing" | "sent" | "failed"; attempts: number; lastError: string | null; sentAt: string | null };

export async function getFeedbackNotificationStatus(ticketId: string): Promise<FeedbackNotificationStatus | null> {
  const [r] = await sql()<{ status: "pending" | "processing" | "sent" | "failed"; attempts: number; last_error: string | null; sent_at: Date | null }[]>`
    select status, attempts, last_error, sent_at from feedback_notifications where ticket_id = ${ticketId}`;
  return r ? { status: r.status, attempts: r.attempts, lastError: r.last_error, sentAt: r.sent_at?.toISOString() ?? null } : null;
}

/**
 * Baris antrean untuk satu tiket, dibuat jika belum ada (tiket lama dari sebelum fitur ini ada, seperti
 * FB-2026-00001, tidak pernah punya baris — pengiriman manual harus tetap bisa dipakai untuk tiket itu).
 */
export async function ensureFeedbackNotificationRow(ticketId: string): Promise<{ id: string; attempts: number }> {
  const [existing] = await sql()<{ id: string; attempts: number }[]>`select id, attempts from feedback_notifications where ticket_id = ${ticketId}`;
  if (existing) return existing;
  const [created] = await sql()<{ id: string; attempts: number }[]>`
    insert into feedback_notifications (ticket_id) values (${ticketId})
    on conflict (ticket_id) do update set ticket_id = excluded.ticket_id
    returning id, attempts`;
  return created;
}

export type FeedbackNotificationAttempt = {
  id: string;
  kind: "auto" | "manual";
  status: "sent" | "failed";
  actorName: string | null;
  error: string | null;
  attemptedAt: string;
};

/** Mencatat SATU percobaan (otomatis atau manual) — histori lengkap, tidak pernah dihapus/ditimpa. */
export async function recordFeedbackNotificationAttempt(
  ticketId: string,
  attempt: { kind: "auto" | "manual"; status: "sent" | "failed"; actorUserId?: string | null; actorName?: string | null; error?: string | null },
): Promise<void> {
  await sql()`
    insert into feedback_notification_attempts (ticket_id, kind, status, actor_user_id, actor_name, error)
    values (${ticketId}, ${attempt.kind}, ${attempt.status}, ${attempt.actorUserId ?? null}, ${attempt.actorName ?? null}, ${attempt.error?.slice(0, 300) ?? null})`;
}

export async function listFeedbackNotificationAttempts(ticketId: string, limit = 20): Promise<FeedbackNotificationAttempt[]> {
  const rows = await sql()<{ id: string; kind: "auto" | "manual"; status: "sent" | "failed"; actor_name: string | null; error: string | null; attempted_at: Date }[]>`
    select id, kind, status, actor_name, error, attempted_at from feedback_notification_attempts
    where ticket_id = ${ticketId} order by attempted_at desc limit ${limit}`;
  return rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, actorName: r.actor_name, error: r.error, attemptedAt: r.attempted_at.toISOString() }));
}
