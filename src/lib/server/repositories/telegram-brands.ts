import "server-only";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError, pgConstraint, pgErrorCode } from "@/lib/server/errors";
import { assertUuid } from "@/lib/server/http";
import { EVENT_LABEL, maskChatId, TELEGRAM_EVENT_TYPES, type TelegramEventType } from "@/lib/telegram-routing";
import type { OutboxStatus, ErrorKind } from "@/lib/server/repositories/notifications";

export type EventFlags = Record<TelegramEventType, boolean>;
/** Target konfigurasi: id brand, atau null untuk Grup Default (cadangan). */
export type BrandTarget = string | null;
/** Nilai `brandId` pada baris daftar & URL untuk Grup Default. */
export const DEFAULT_TARGET = "default";
export const DEFAULT_GROUP_NAME = "Grup Telegram Global";

/**
 * Parameter URL → target. Hanya grup global ("default") yang dikelola: konfigurasi per brand tidak lagi dipakai
 * routing, sehingga tidak bisa dibuat atau diubah (data lama tetap tersimpan).
 */
export function parseBrandTarget(raw: string): BrandTarget {
  if (raw === DEFAULT_TARGET) return null;
  assertUuid(raw, "Brand");
  throw new NotFoundError("Konfigurasi Telegram per brand tidak lagi dipakai. Kelola grup global di Integrasi Telegram.");
}

/** Grup global untuk halaman Integrasi Telegram (tanpa chat ID mentah). Null bila belum dihubungkan. */
export async function globalGroup(): Promise<BrandChannel | null> {
  const [r] = await sql()<ChannelRow[]>`select * from telegram_brand_channels where brand_id is null`;
  return r ? channelOf(r) : null;
}
export type VerificationStatus = "unverified" | "verified" | "bot_no_access" | "failed";

export type BrandChannel = {
  configId: string;
  chatMasked: string;
  chatTitle: string | null;
  chatUsername: string | null;
  sourceLink: string | null;
  /** ID topik tujuan pada grup forum (null = General / grup tanpa topik). */
  topicId: number | null;
  isActive: boolean;
  verificationStatus: VerificationStatus;
  verifiedAt: string | null;
  events: EventFlags;
  lastTestedAt: string | null;
  lastTestResult: "ok" | "failed" | null;
  lastTestMessage: string | null;
  updatedAt: string;
};

export type BrandRow = {
  brandId: string;
  brandName: string;
  brandActive: boolean;
  channel: BrandChannel | null;
  lastSentAt: string | null;
  failedCount: number;
};

export type VerifiedChat = { chatId: string; chatTitle: string | null; chatUsername: string | null; sourceLink: string; threadId: number | null };
export type SaveVerifiedResult = { kind: "saved"; created: boolean } | { kind: "replace_required"; currentTitle: string | null };

type ChannelRow = {
  id: string; brand_id: string | null; chat_id: string; is_active: boolean; verification_status: VerificationStatus;
  source_link: string | null; chat_title: string | null; chat_username: string | null; verified_at: Date | null; message_thread_id: number | null;
  notify_new_order: boolean; notify_status_changed: boolean; notify_waiting_confirmation: boolean; notify_completed: boolean;
  notify_on_hold: boolean; notify_cancelled: boolean; notify_pic_changed: boolean; last_tested_at: Date | null; last_test_result: "ok" | "failed" | null;
  last_test_message: string | null; updated_at: Date;
};

function eventsOf(r: ChannelRow): EventFlags {
  return {
    new_order: r.notify_new_order,
    status_changed: r.notify_status_changed,
    waiting_confirmation: r.notify_waiting_confirmation,
    completed: r.notify_completed,
    on_hold: r.notify_on_hold,
    cancelled: r.notify_cancelled,
    pic_changed: r.notify_pic_changed,
  };
}

function channelOf(r: ChannelRow): BrandChannel {
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
    events: eventsOf(r),
    lastTestedAt: r.last_tested_at?.toISOString() ?? null,
    lastTestResult: r.last_test_result,
    lastTestMessage: r.last_test_message,
    updatedAt: r.updated_at.toISOString(),
  };
}

/** Semua brand beserta konfigurasi Telegram-nya (null bila belum dihubungkan). Tanpa chat ID mentah. */
export async function listBrandRows(): Promise<BrandRow[]> {
  const brands = await sql()<{ id: string; name: string; is_active: boolean; last_sent_at: Date | null; failed_count: number }[]>`
    select b.id, b.name, b.is_active,
           (select max(n.sent_at) from notification_outbox n where n.brand_id = b.id and n.status = 'sent') as last_sent_at,
           (select count(*)::int from notification_outbox n where n.brand_id = b.id and n.status = 'failed') as failed_count
    from brands b order by b.sort_order, b.name`;
  const channels = await sql()<ChannelRow[]>`select * from telegram_brand_channels`;
  const byBrand = new Map(channels.map((c) => [c.brand_id, c]));
  const def = channels.find((c) => c.brand_id === null);
  const [defStats] = def
    ? await sql()<{ last_sent_at: Date | null; failed_count: number }[]>`
        select max(sent_at) filter (where status = 'sent') as last_sent_at, (count(*) filter (where status = 'failed'))::int as failed_count
        from notification_outbox where config_id = ${def.id}`
    : [];
  const defaultRow: BrandRow = {
    brandId: DEFAULT_TARGET,
    brandName: DEFAULT_GROUP_NAME,
    brandActive: true,
    channel: def ? channelOf(def) : null,
    lastSentAt: defStats?.last_sent_at?.toISOString() ?? null,
    failedCount: defStats?.failed_count ?? 0,
  };
  return [defaultRow, ...brands.map((b) => {
    const c = byBrand.get(b.id);
    return {
      brandId: b.id,
      brandName: b.name,
      brandActive: b.is_active,
      channel: c ? channelOf(c) : null,
      lastSentAt: b.last_sent_at?.toISOString() ?? null,
      failedCount: b.failed_count,
    };
  })];
}

/**
 * Simpan grup yang BARU saja terverifikasi (chat_id berasal dari Telegram Bot API). Jika brand sudah punya
 * grup terverifikasi yang berbeda, penggantian hanya dilakukan bila `replace` true (konfirmasi eksplisit).
 * Penggantian menonaktifkan integrasi: grup baru harus diaktifkan lagi secara sadar.
 */
export async function saveVerifiedChannel(brandId: BrandTarget, v: VerifiedChat, actorId: string, replace: boolean): Promise<SaveVerifiedResult> {
  try {
    return await sql().begin(async (tx): Promise<SaveVerifiedResult> => {
      if (brandId) {
        const [brand] = await tx<{ id: string }[]>`select id from brands where id = ${brandId}`;
        if (!brand) throw new NotFoundError("Brand tidak ditemukan.");
      }
      const [existing] = await tx<{ id: string; chat_id: string; verification_status: VerificationStatus; chat_title: string | null }[]>`
        select id, chat_id, verification_status, chat_title from telegram_brand_channels where brand_id is not distinct from ${brandId} for update`;
      if (existing) {
        const changed = existing.chat_id !== v.chatId;
        if (changed && existing.verification_status === "verified" && !replace) {
          return { kind: "replace_required", currentTitle: existing.chat_title };
        }
        await tx`
          update telegram_brand_channels set
            chat_id = ${v.chatId}, chat_title = ${v.chatTitle}, chat_username = ${v.chatUsername}, source_link = ${v.sourceLink},
            message_thread_id = ${v.threadId},
            verification_status = 'verified', verified_at = now(),
            is_active = case when ${changed} then false else is_active end,
            last_test_result = case when ${changed} then null else last_test_result end,
            last_test_message = case when ${changed} then null else last_test_message end,
            last_tested_at = case when ${changed} then null else last_tested_at end,
            updated_by = ${actorId}
          where id = ${existing.id}`;
        return { kind: "saved", created: false };
      }
      await tx`
        insert into telegram_brand_channels (brand_id, chat_id, chat_title, chat_username, source_link, message_thread_id, verification_status, verified_at,
          is_active, created_by, updated_by)
        values (${brandId}, ${v.chatId}, ${v.chatTitle}, ${v.chatUsername}, ${v.sourceLink}, ${v.threadId}, 'verified', now(), false, ${actorId}, ${actorId})`;
      return { kind: "saved", created: true };
    });
  } catch (error) {
    if (pgErrorCode(error) === "23505" && pgConstraint(error) === "telegram_brand_channels_chat_key") {
      throw new AppError("Grup ini sudah terhubung ke brand lain atau ke Grup Default. Satu grup Telegram hanya untuk satu tujuan.", 409, { link: "Grup sudah dipakai tujuan lain." });
    }
    throw error;
  }
}

/**
 * Putuskan grup dari brand (atau Grup Default). Riwayat pengiriman tetap ada. Notifikasi yang belum terkirim ke grup
 * ini tidak hilang: pengajuan baru kembali "menunggu tujuan" (lalu dirutekan ulang), event status dilewati dengan alasan.
 */
export async function disconnectChannel(brandId: BrandTarget): Promise<{ chatTitle: string | null; requeued: number }> {
  return sql().begin(async (tx) => {
    const [ch] = await tx<{ id: string; chat_title: string | null }[]>`
      select id, chat_title from telegram_brand_channels where brand_id is not distinct from ${brandId} for update`;
    if (!ch) throw new NotFoundError("Grup Telegram untuk tujuan ini belum terhubung.");
    const requeued = await tx<{ id: string }[]>`
      update notification_outbox set status = 'awaiting_destination', config_id = null, chat_id = null,
        last_error = ${SKIP_REASON_DISCONNECTED}, locked_at = null
      where config_id = ${ch.id} and kind = 'order_created' and status in ('pending', 'processing', 'retrying')
      returning id`;
    await tx`
      update notification_outbox set status = 'skipped', last_error = ${"Grup Telegram diputuskan sebelum pesan terkirim."}, locked_at = null
      where config_id = ${ch.id} and status in ('pending', 'processing', 'retrying')`;
    await tx`delete from telegram_brand_channels where id = ${ch.id}`;
    return { chatTitle: ch.chat_title, requeued: requeued.length };
  });
}

const SKIP_REASON_DISCONNECTED = "Grup Telegram diputuskan; notifikasi menunggu tujuan baru (grup brand atau Grup Default).";

/** Ubah jenis notifikasi dan status aktif. Aktivasi hanya untuk grup terverifikasi. */
export async function updateBrandSettings(brandId: BrandTarget, input: { isActive: boolean; events: EventFlags }, actorId: string): Promise<void> {
  const e = input.events;
  const rows = await sql()<{ verification_status: VerificationStatus }[]>`
    update telegram_brand_channels set
      is_active = case when ${input.isActive} and verification_status = 'verified' then true else false end,
      notify_new_order = ${e.new_order}, notify_status_changed = ${e.status_changed},
      notify_waiting_confirmation = ${e.waiting_confirmation}, notify_completed = ${e.completed},
      notify_on_hold = ${e.on_hold}, notify_cancelled = ${e.cancelled}, notify_pic_changed = ${e.pic_changed}, updated_by = ${actorId}
    where brand_id is not distinct from ${brandId}
    returning verification_status`;
  if (rows.length === 0) throw new NotFoundError("Grup Telegram untuk brand ini belum diverifikasi.");
  if (input.isActive && rows[0].verification_status !== "verified") {
    throw new AppError("Verifikasi grup terlebih dahulu sebelum mengaktifkan integrasi.", 409, { isActive: "Belum terverifikasi." });
  }
}

/** Keadaan grup global: aktif & terverifikasi, ada tetapi tidak aktif, atau belum ada. */
export async function globalGroupState(): Promise<"active" | "inactive" | "none"> {
  const [r] = await sql()<{ is_active: boolean; verification_status: string }[]>`
    select is_active, verification_status from telegram_brand_channels where brand_id is null`;
  if (!r) return "none";
  return r.is_active && r.verification_status === "verified" ? "active" : "inactive";
}

/** Konfigurasi brand untuk tes & verifikasi (tanpa tampilan). Null bila belum dibuat. */
export async function channelForBrand(brandId: BrandTarget): Promise<{ configId: string; brandName: string; chatId: string; threadId: number | null; isActive: boolean; verificationStatus: VerificationStatus; notifyNewOrder: boolean } | null> {
  const [r] = await sql()<{ id: string; name: string; chat_id: string; message_thread_id: number | null; is_active: boolean; verification_status: VerificationStatus; notify_new_order: boolean }[]>`
    select c.id, coalesce(b.name, ${DEFAULT_GROUP_NAME}) as name, c.chat_id, c.message_thread_id, c.is_active, c.verification_status, c.notify_new_order
    from telegram_brand_channels c left join brands b on b.id = c.brand_id where c.brand_id is not distinct from ${brandId}`;
  return r
    ? { configId: r.id, brandName: r.name, chatId: r.chat_id, threadId: r.message_thread_id, isActive: r.is_active, verificationStatus: r.verification_status, notifyNewOrder: r.notify_new_order }
    : null;
}

export async function brandName(brandId: BrandTarget): Promise<string | null> {
  if (brandId === null) return DEFAULT_GROUP_NAME;
  const [r] = await sql()<{ name: string }[]>`select name from brands where id = ${brandId}`;
  return r?.name ?? null;
}

/**
 * Kunci tes singkat: hanya satu tes per brand dalam jendela waktu. Mengembalikan false bila sedang dikunci.
 * Mencegah klik ganda mengirim beberapa pesan tes.
 */
export async function acquireTestLock(brandId: BrandTarget, seconds = 20): Promise<boolean> {
  const rows = await sql()<{ id: string }[]>`
    update telegram_brand_channels set test_locked_until = now() + make_interval(secs => ${seconds})
    where brand_id is not distinct from ${brandId} and (test_locked_until is null or test_locked_until < now())
    returning id`;
  return rows.length > 0;
}

export async function releaseTestLock(brandId: BrandTarget): Promise<void> {
  await sql()`update telegram_brand_channels set test_locked_until = null where brand_id is not distinct from ${brandId}`;
}

/** Catat hasil tes. Bila bot ditolak, status menjadi bot_no_access dan integrasi dinonaktifkan. */
export async function recordTestResult(brandId: BrandTarget, result: { ok: boolean; message: string; botNoAccess: boolean }): Promise<void> {
  await sql()`
    update telegram_brand_channels set
      last_tested_at = now(),
      last_test_result = ${result.ok ? "ok" : "failed"},
      last_test_message = ${result.message.slice(0, 300)},
      verification_status = case when ${result.botNoAccess} then 'bot_no_access' else verification_status end,
      is_active = case when ${result.botNoAccess} then false else is_active end
    where brand_id is not distinct from ${brandId}`;
}

export type BrandHistoryRow = {
  id: string;
  orderNumber: string;
  kind: string;
  eventType: TelegramEventType | null;
  eventLabel: string;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  errorKind: ErrorKind | null;
  errorCode: number | null;
  lastError: string | null;
  chatMasked: string | null;
  sentAt: string | null;
  updatedAt: string;
};

/** Riwayat pengiriman satu brand (Super Admin). Hanya kode error aman dan chat ID tersamarkan. */
export async function brandHistory(brandId: BrandTarget, limit = 50): Promise<BrandHistoryRow[]> {
  const rows = await sql()<{
    id: string; order_number: string; kind: string; event_type: TelegramEventType | null; status: OutboxStatus; attempts: number;
    max_attempts: number; error_kind: ErrorKind | null; error_code: number | null; last_error: string | null; chat_id: string | null;
    sent_at: Date | null; updated_at: Date;
  }[]>`
    select n.id, o.order_number, n.kind, n.event_type, n.status, n.attempts, n.max_attempts, n.error_kind, n.error_code,
           n.last_error, n.chat_id, n.sent_at, n.updated_at
    from notification_outbox n join orders o on o.id = n.order_id
    where ${brandId === null
      ? sql()`n.config_id = (select id from telegram_brand_channels where brand_id is null)`
      : sql()`n.brand_id = ${brandId}`}
    order by n.created_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    orderNumber: r.order_number,
    kind: r.kind,
    eventType: r.event_type,
    eventLabel: r.event_type && (TELEGRAM_EVENT_TYPES as readonly string[]).includes(r.event_type) ? EVENT_LABEL[r.event_type] : "Pengajuan baru",
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    errorKind: r.error_kind,
    errorCode: r.error_code,
    lastError: r.last_error,
    chatMasked: r.chat_id ? maskChatId(r.chat_id) : null,
    sentAt: r.sent_at?.toISOString() ?? null,
    updatedAt: r.updated_at.toISOString(),
  }));
}
