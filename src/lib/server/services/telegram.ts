import "server-only";
import {
  buildOrderMessage,
  buildPicChangeMessage,
  buildStatusMessage,
  escapeHtml,
  publicAppUrl,
  diagnoseBotConfig,
  botDiagnosisMessage,
  readBotConfig,
  TEST_MESSAGE_PREFIX,
  telegramErrorMessage,
  TELEGRAM_TIMEOUT_MS,
  type BotConfig,
} from "@/lib/telegram";
import { recordAudit } from "@/lib/server/repositories/audit";
import { NotFoundError } from "@/lib/server/errors";
import {
  claimDueOutbox,
  claimOutboxById,
  currentChannel,
  newOrderOutboxRows,
  getOrderNotificationData,
  getPicChangeData,
  getStatusEventData,
  markOutboxFailed,
  markOutboxRetrying,
  markOutboxSent,
  markOutboxSkipped,
  outboxStateById,
  awaitingNewOrderRow,
  countAwaitingDestination,
  rerouteAwaitingDestination,
  rescheduleAllUnsent,
  resolveOrderDestination,
  telegramOutboxSummary,
  upsertManualOutbox,
  type ClaimedOutbox,
  type OutboxSummary,
} from "@/lib/server/repositories/notifications";
import { acquireTestLock, channelForBrand, globalGroupState, recordTestResult, releaseTestLock, type BrandTarget } from "@/lib/server/repositories/telegram-brands";
import { classifyFailure, decideAfterAttempt, MAX_ATTEMPTS, retryDelaysSeconds, type FailureKind } from "@/lib/telegram-retry";
import { maskChatId, SKIP_REASON } from "@/lib/telegram-routing";
import { updateWorkerState, workerState, type WorkerState } from "@/lib/server/services/telegram-worker-state";
import { callTelegramApi } from "@/lib/server/services/telegram-api";
import { classifyNetworkError, describeApiFailure, safeLogLine } from "@/lib/telegram-api";
import { formatDateTime } from "@/lib/dates";

export type SendResult = { ok: true } | { ok: false; message: string; kind: FailureKind; errorCode?: number; retryAfterSeconds?: number };

export const NO_TOKEN_MESSAGE = "Token bot belum dikonfigurasi di server (TELEGRAM_BOT_TOKEN).";

/** Satu panggilan sendMessage ke chat tertentu. Tidak pernah melempar; token tidak pernah masuk ke pesan galat. */
export async function sendTelegramText(bot: BotConfig, chatId: string, text: string, threadId: number | null = null): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch(`${bot.apiBase}/bot${bot.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // message_thread_id: topik tujuan pada grup forum (tanpa ini Telegram menaruh pesan di General).
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...(threadId ? { message_thread_id: threadId } : {}) }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      redirect: "error",
    });
  } catch (error) {
    // Galat transport bersifat sementara. Jika koneksi putus setelah Telegram menerima pesan, percobaan ulang
    // bisa menghasilkan pesan ganda: Telegram tidak menyediakan idempotency key untuk sendMessage.
    const outcome = { ok: false as const, kind: "network" as const, ...classifyNetworkError(error) };
    console.error(safeLogLine("sendMessage", outcome));
    return { ok: false, kind: "transient", message: describeApiFailure(outcome) };
  }
  if (res.ok) return { ok: true };
  // Respons API asli: { ok:false, error_code, description, parameters.retry_after }. Hanya field itu yang dibaca.
  let errorCode = res.status;
  let description = "";
  let retryAfterSeconds: number | undefined;
  try {
    const body = (await res.json()) as { error_code?: unknown; description?: unknown; parameters?: { retry_after?: unknown } };
    if (typeof body.error_code === "number") errorCode = body.error_code;
    if (typeof body.description === "string") description = body.description;
    if (typeof body.parameters?.retry_after === "number") retryAfterSeconds = body.parameters.retry_after;
  } catch {
    // respons non-JSON: pakai status HTTP saja
  }
  const kind = classifyFailure({ errorCode, retryAfterSeconds });
  return { ok: false, kind, errorCode, retryAfterSeconds, message: telegramErrorMessage(errorCode, description) };
}

/** Keterangan status untuk disimpan & ditampilkan. Jadwal ulang hanya disebut bila benar-benar tersimpan. */
function describeOutcome(claim: ClaimedOutbox, decision: ReturnType<typeof decideAfterAttempt>, message: string, nextAt?: Date): string {
  if (decision.status === "retrying" && nextAt) {
    return `Pengiriman gagal sementara (percobaan ${claim.attempts} dari ${MAX_ATTEMPTS}). Dijadwalkan ulang pukul ${formatDateTime(nextAt)}. ${message}`;
  }
  if (decision.status === "failed" && decision.errorKind === "transient") {
    return `Percobaan habis (${claim.attempts} dari ${MAX_ATTEMPTS}). ${message}`;
  }
  return `Gagal permanen, tidak diulang. Perbaiki konfigurasi lalu kirim ulang. ${message}`;
}

/**
 * Kerjakan satu klaim: pastikan grup brand masih aktif dan tidak berubah sejak antrean dibuat, bangun pesan
 * dari database, kirim KE CHAT YANG TERCATAT di antrean, lalu tandai hasilnya. Tidak pernah melempar.
 */
async function dispatchClaim(claim: ClaimedOutbox, bot: BotConfig): Promise<void> {
  let label = "";
  try {
    // Grup tujuan (brand atau default) harus masih aktif, terverifikasi, dan tidak berubah sejak antrean dibuat.
    const channel = await currentChannel(claim.config_id);
    if (!channel || !channel.isActive || !channel.verified || channel.chatId !== claim.chat_id) {
      await markOutboxSkipped(claim.id, SKIP_REASON.channel_changed);
      return;
    }
    let text: string | null = null;
    if (claim.kind === "order_created") {
      const data = await getOrderNotificationData(claim.order_id);
      if (data) {
        text = buildOrderMessage(data, bot.appUrl);
        label = data.orderNumber;
      }
    } else if (claim.kind === "pic_changed") {
      const data = await getPicChangeData(claim.order_id, claim.event_ref);
      if (data) {
        text = buildPicChangeMessage(data, bot.appUrl);
        label = `${data.orderNumber} (PIC)`;
      }
    } else {
      const data = await getStatusEventData(claim.order_id, claim.event_ref);
      if (data) {
        text = buildStatusMessage(data, bot.appUrl);
        label = `${data.orderNumber} (status)`;
      }
    }
    if (!text) {
      await markOutboxFailed(claim.id, "Data order tidak ditemukan.", "permanent");
      return;
    }
    const attemptedAt = new Date().toISOString();
    const result = await sendTelegramText(bot, claim.chat_id, text, channel.threadId);
    if (result.ok) {
      await markOutboxSent(claim.id);
      console.info(`[telegram] ${label}: terkirim ke ${channel.isDefault ? "grup global" : "grup lama"} (${maskChatId(claim.chat_id)}${channel.threadId ? `, topik #${channel.threadId}` : ""}), percobaan ${claim.attempts}, ${attemptedAt}`);
      return;
    }
    console.error(`[telegram] ${label}: Telegram menolak/gagal (${result.errorCode ?? "tanpa respons"}), percobaan ${claim.attempts}, ${attemptedAt}`);
    const decision = decideAfterAttempt({
      ok: false,
      attemptsDone: claim.attempts,
      kind: result.kind,
      retryAfterSeconds: result.retryAfterSeconds,
      delays: retryDelaysSeconds(),
    });
    if (decision.status === "retrying") {
      const nextAt = new Date(Date.now() + decision.delaySeconds * 1000);
      await markOutboxRetrying(claim.id, decision.delaySeconds, describeOutcome(claim, decision, result.message, nextAt), result.errorCode ?? null);
      console.error(`[telegram] ${label}: percobaan ${claim.attempts} gagal sementara, dijadwalkan ulang dalam ${decision.delaySeconds} dtk`);
    } else {
      const kind = decision.status === "failed" ? decision.errorKind : "permanent";
      await markOutboxFailed(claim.id, describeOutcome(claim, decision, result.message), kind, result.errorCode ?? null);
      console.error(`[telegram] ${label}: berhenti (${kind}) setelah ${claim.attempts} percobaan`);
    }
  } catch (error) {
    // Hanya nama galat; pesan galat database/jaringan bisa memuat detail yang tidak boleh keluar.
    console.error("[telegram] kesalahan internal pengiriman", error instanceof Error ? error.name : "unknown");
    const delay = retryDelaysSeconds()[0] ?? 3;
    await markOutboxRetrying(claim.id, delay, `Kesalahan internal saat pengiriman. Dijadwalkan ulang pukul ${formatDateTime(new Date(Date.now() + delay * 1000))}.`).catch(() => {});
  }
}

/** Kirim satu notifikasi sekarang (percobaan langsung setelah pengajuan / kirim ulang). Tidak pernah melempar. */
export async function notifyOutbox(outboxId: string): Promise<void> {
  const bot = readBotConfig();
  if (!bot) return; // token belum dikonfigurasi: antrean tetap menunggu
  try {
    const claim = await claimOutboxById(outboxId);
    if (claim) await dispatchClaim(claim, bot);
  } catch (error) {
    console.error("[telegram] klaim antrean gagal", error instanceof Error ? error.name : "unknown");
  }
}

/**
 * Worker: proses notifikasi yang sudah jatuh tempo, termasuk yang tertunda sebelum server restart.
 * Aman dijalankan berulang dan bersamaan: klaim memakai FOR UPDATE SKIP LOCKED. Mengembalikan jumlah baris diproses.
 */
let lastTokenStatus: string | null = null;
let lastAwaiting: number | null = null;

export async function processDueOutbox(limit = 10): Promise<number> {
  const bot = readBotConfig();
  const tokenStatus = diagnoseBotConfig().status;
  if (tokenStatus !== lastTokenStatus) {
    // Dicatat hanya saat berubah, tanpa nilai token.
    if (tokenStatus !== "ok") console.error(`[telegram-worker] token bot tidak siap (${tokenStatus}); antrean tidak diproses sampai diperbaiki`);
    lastTokenStatus = tokenStatus;
  }
  if (!bot) return 0;
  // Event yang menunggu tujuan dipindahkan ke antrean kirim begitu ada grup aktif (tanpa event/pengajuan baru).
  let rerouted = 0;
  try {
    rerouted = await rerouteAwaitingDestination(limit);
    if (rerouted > 0) console.info(`[telegram-worker] ${rerouted} notifikasi yang menunggu tujuan dipindahkan ke antrean kirim`);
  } catch (error) {
    console.error("[telegram-worker] pemulihan tujuan gagal", error instanceof Error ? error.name : "unknown");
  }
  updateWorkerState({ lastRerouted: rerouted });
  const awaiting = await countAwaitingDestination().catch(() => null);
  if (awaiting !== null && awaiting !== lastAwaiting) {
    console.info(`[telegram-worker] menunggu tujuan: ${awaiting} notifikasi${awaiting > 0 ? " (belum ada grup brand atau Grup Default yang aktif untuk brand terkait)" : ""}`);
    lastAwaiting = awaiting;
  }
  const claims = await claimDueOutbox(limit);
  for (const claim of claims) await dispatchClaim(claim, bot);
  return claims.length;
}

export type DeliveryState = "sent" | "pending" | "failed" | "no_destination";
export type DeliveryResult = { state: DeliveryState; detail: string };

/**
 * Kirim notifikasi pengajuan baru SEKARANG ke semua tujuan yang siap (grup brand, atau cadangan default), lalu
 * laporkan hasil nyata dari antrean. "sent" HANYA bila setiap tujuan siap berstatus terkirim (Telegram ok:true).
 * Tidak pernah melempar; tidak membuat order; aman diulang (baris yang sudah terkirim tidak dikirim lagi).
 */
export async function deliverNewOrder(orderId: string): Promise<DeliveryResult> {
  try {
    // Token adalah syarat mutlak. Tanpanya tidak ada pengiriman yang mungkin: laporkan penyebab nyata.
    const diagnosis = diagnoseBotConfig();
    const tokenProblem = botDiagnosisMessage(diagnosis);
    if (tokenProblem) return { state: "failed", detail: tokenProblem };
    const rows = await newOrderOutboxRows(orderId);
    for (const r of rows) {
      if (r.status === "pending" || r.status === "retrying") await notifyOutbox(r.id);
    }
    const states = (await Promise.all(rows.map((r) => outboxStateById(r.id)))).filter((s): s is NonNullable<typeof s> => s !== null);
    const live = states.filter((s) => s.status !== "skipped" && s.status !== "awaiting_destination");
    if (live.length === 0) {
      const reasons = states.map((s) => s.lastError).filter(Boolean).join(" ");
      return { state: "no_destination", detail: reasons || SKIP_REASON.no_channel };
    }
    if (live.every((s) => s.status === "sent")) return { state: "sent", detail: "Terkirim ke grup Telegram tujuan." };
    const waiting = live.find((s) => s.status === "pending" || s.status === "processing" || s.status === "retrying");
    if (waiting) return { state: "pending", detail: waiting.lastError ?? "Dijadwalkan ulang otomatis." };
    const failed = live.find((s) => s.status === "failed");
    return { state: "failed", detail: failed?.lastError ?? "Notifikasi gagal dikirim." };
  } catch (error) {
    console.error("[telegram] antrean pengajuan tidak terbaca", error instanceof Error ? error.name : "unknown");
    return { state: "pending", detail: "Notifikasi belum dapat diproses; sistem akan mencoba ulang." };
  }
}

/**
 * Pulihkan event yang menunggu tujuan setelah grup diaktifkan, lalu langsung proses antreannya.
 * Tidak membuat event atau pengajuan baru; baris yang sudah terkirim tidak disentuh.
 */
export async function recoverAwaitingNotifications(): Promise<number> {
  const moved = await rerouteAwaitingDestination(50);
  if (moved > 0) await processDueOutbox(Math.min(moved, 20));
  return moved;
}

/** Aksi "Kirim ulang yang tertunda" (Super Admin): jadwalkan ulang semua yang belum terkirim, lalu proses sekarang. */
export async function retryUnsentNotifications(limit = 20): Promise<{ attempted: number }> {
  if (!readBotConfig()) return { attempted: 0 };
  const rerouted = await rerouteAwaitingDestination(limit);
  const scheduled = (await rescheduleAllUnsent(limit)) + rerouted;
  const processed = await processDueOutbox(limit);
  return { attempted: Math.max(scheduled, processed) };
}

/**
 * Uji koneksi TOKEN & chat dari environment (jalur kompatibilitas lama). Tidak menulis ke outbox dan
 * TIDAK dipakai untuk routing order: tujuan order selalu grup brand masing-masing.
 */
export async function sendTestNotification(): Promise<SendResult> {
  const bot = readBotConfig();
  if (!bot) return { ok: false, kind: "permanent", message: botDiagnosisMessage(diagnoseBotConfig()) ?? "Token bot belum dikonfigurasi." };
  const chat = process.env.TELEGRAM_CHAT_ID?.trim() ?? "";
  if (!chat) return { ok: false, kind: "permanent", message: "TELEGRAM_CHAT_ID tidak diisi. Gunakan Kirim Pesan Uji pada kartu Grup Telegram global." };
  return sendTelegramText(bot, chat, "✅ Uji koneksi DTIC Connect. Pesan ini bukan pengajuan order.");
}

/**
 * Tes pesan untuk satu brand (Super Admin). Hanya untuk grup yang sudah terverifikasi. Mengirim satu pesan
 * tes ke chat yang tersimpan; tidak membuat antrean, tidak mengubah order, dan tidak masuk jalur retry.
 * Klik ganda ditahan oleh kunci singkat per brand.
 */
export async function testBrandChannel(brandId: BrandTarget, actorId: string): Promise<{ ok: boolean; busy?: boolean; message: string }> {
  const bot = readBotConfig();
  if (!bot) return { ok: false, message: NO_TOKEN_MESSAGE };
  const channel = await channelForBrand(brandId);
  if (!channel) throw new NotFoundError("Grup Telegram untuk brand ini belum dibuat.");
  if (channel.verificationStatus !== "verified") return { ok: false, message: "Verifikasi grup terlebih dahulu sebelum tes pesan." };
  if (!(await acquireTestLock(brandId))) {
    return { ok: false, busy: true, message: "Tes pesan baru saja dijalankan. Tunggu sebentar sebelum mencoba lagi." };
  }
  try {
    const text = `✅ Tes koneksi DTIC Connect berhasil. Grup ini telah terhubung untuk brand <b>${escapeHtml(channel.brandName)}</b>.\nPesan ini bukan pekerjaan baru.`;
    const r = await sendTelegramText(bot, channel.chatId, text, channel.threadId);
    const botNoAccess = !r.ok && (r.errorCode === 403 || r.errorCode === 400);
    const message = r.ok ? "Pesan tes terkirim ke grup." : r.message;
    await recordTestResult(brandId, { ok: r.ok, message, botNoAccess });
    await recordAudit(actorId, "telegram_brand_tested", { brand: channel.brandName, ok: r.ok });
    if (r.ok) return { ok: true, message: "Pesan tes terkirim ke grup. Pesan ini bukan pekerjaan baru." };
    return {
      ok: false,
      message: botNoAccess ? `${message} Pastikan bot masih menjadi anggota grup dan memiliki izin mengirim pesan, lalu verifikasi ulang.` : message,
    };
  } finally {
    await releaseTestLock(brandId);
  }
}

export type IntegrationState = "not_configured" | "untested" | "active" | "problem";

export type IntegrationStatus = {
  state: IntegrationState;
  stateLabel: string;
  /** Hanya penanda ada/tidak; nilai token & chat ID tidak pernah dikembalikan. */
  configured: { token: boolean; chatId: boolean };
  /** Diagnosis aman untuk administrator (tanpa nilai token). */
  diagnosis: { token: "ok" | "missing" | "invalid_format" | "invalid_api_base"; globalGroup: "active" | "inactive" | "none" };
  /** Detak worker antrean di proses server ini. */
  worker: WorkerState;
  outbox: OutboxSummary;
};

export async function getIntegrationStatus(): Promise<IntegrationStatus> {
  const outbox = await telegramOutboxSummary();
  const bot = readBotConfig();
  const configured = {
    token: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    chatId: Boolean(process.env.TELEGRAM_CHAT_ID?.trim()),
  };
  let state: IntegrationState;
  if (!bot) state = "not_configured";
  else if (outbox.lastFailedAt && (!outbox.lastSentAt || outbox.lastFailedAt > outbox.lastSentAt)) state = "problem";
  else if (outbox.lastSentAt) state = "active";
  else state = "untested";
  const stateLabel = {
    not_configured: "Token bot belum dikonfigurasi",
    untested: "Token dikonfigurasi, belum ada pengiriman",
    active: "Aktif",
    problem: "Bermasalah",
  }[state];
  const diagnosis = { token: diagnoseBotConfig().status, globalGroup: await globalGroupState() };
  return { state, stateLabel, configured, diagnosis, worker: workerState(), outbox };
}

export type PreviewDestination = { kind: "global" | "none"; brandName: string | null; reason: string | null };

/**
 * Pratinjau pesan order (dari data database). Tidak mengirim apa pun. Token dan tujuan dilaporkan TERPISAH, dan tujuan
 * dihitung dengan aturan yang sama dengan antrean (grup brand → Grup Default → menunggu tujuan).
 */
export async function previewOrderMessage(orderId: string, test: boolean): Promise<{ text: string; tokenConfigured: boolean; tokenProblem: string | null; destination: PreviewDestination } | null> {
  const data = await getOrderNotificationData(orderId);
  if (!data) return null;
  const bot = readBotConfig();
  const route = await resolveOrderDestination(orderId);
  const destination: PreviewDestination =
    route.destination === "global"
      ? { kind: "global", brandName: data.brandName, reason: null }
      : { kind: "none", brandName: data.brandName, reason: route.reason === SKIP_REASON.event_disabled ? route.reason : NO_DESTINATION_RESEND_MESSAGE };
  return {
    text: (test ? TEST_MESSAGE_PREFIX : "") + buildOrderMessage(data, publicAppUrl(process.env)),
    tokenConfigured: bot !== null,
    tokenProblem: botDiagnosisMessage(diagnoseBotConfig()),
    destination,
  };
}

export type ActionResult = { ok: boolean; message: string; code?: "no_destination" | "awaiting_destination" | "no_token" };

export const NO_DESTINATION_RESEND_MESSAGE =
  "Belum ada tujuan Telegram yang aktif. Hubungkan dan aktifkan grup Telegram global di Integrasi Telegram sebelum mengirim ulang.";
const QUEUED_NOTE = " Permintaan disimpan di antrean (Menunggu Tujuan) dan dikirim otomatis setelah grup aktif.";

/**
 * Kirim ulang notifikasi pengajuan SEKARANG (Super Admin). Tujuan: grup brand → Grup Default → menunggu tujuan.
 * Kunci idempoten = event_ref, sehingga klik ganda tidak mengirim dua kali. Bila event asli masih menunggu tujuan,
 * tidak dibuat antrean kedua (mencegah dua pesan saat grup diaktifkan). Hasil diambil dari status outbox nyata.
 */
export async function resendOrderNow(orderId: string, key: string, actorId: string): Promise<ActionResult> {
  const data = await getOrderNotificationData(orderId);
  if (!data) throw new NotFoundError("Order tidak ditemukan.");
  if (!readBotConfig()) return { ok: false, code: "no_token", message: botDiagnosisMessage(diagnoseBotConfig()) ?? NO_TOKEN_MESSAGE };

  const waiting = await awaitingNewOrderRow(orderId);
  if (waiting) {
    await recoverAwaitingNotifications(); // tujuan mungkin sudah tersedia sekarang
    const st = await outboxStateById(waiting);
    if (st?.status === "sent") return { ok: true, message: "Pesan terkirim ke grup Telegram tujuan." };
    if (st?.status === "awaiting_destination") {
      return { ok: false, code: "awaiting_destination", message: NO_DESTINATION_RESEND_MESSAGE + QUEUED_NOTE };
    }
    return { ok: false, message: st?.lastError ?? "Pengiriman masih diproses. Periksa riwayat beberapa saat lagi." };
  }

  const { id, created } = await upsertManualOutbox(orderId, key);
  await notifyOutbox(id);
  const st = await outboxStateById(id);
  const result: ActionResult = (() => {
    if (!st) return { ok: false, message: "Antrean pengiriman tidak ditemukan." };
    if (st.status === "sent") return { ok: true, message: "Pesan terkirim ke grup Telegram tujuan." };
    if (st.status === "awaiting_destination") return { ok: false, code: "no_destination", message: NO_DESTINATION_RESEND_MESSAGE + QUEUED_NOTE };
    if (st.status === "skipped") return { ok: false, message: st.lastError ?? SKIP_REASON.no_destination };
    if (st.status === "retrying") return { ok: false, message: st.lastError ?? "Pengiriman gagal sementara. Percobaan berikutnya dijadwalkan otomatis." };
    if (st.status === "failed") return { ok: false, message: st.lastError ?? "Pengiriman gagal." };
    return { ok: false, message: "Pengiriman masih diproses. Periksa riwayat pengiriman beberapa saat lagi." };
  })();
  // Hanya pengiriman baru yang dicatat; pengulangan dengan kunci yang sama tidak menambah jejak.
  if (created) await recordAudit(actorId, "telegram_resent", { orderNumber: data.orderNumber, status: st?.status ?? "unknown" });
  return result;
}

/** Pesan uji untuk satu order ke tujuan yang sama dengan antrean. Berlabel uji, tidak masuk antrean, tidak mengubah data. */
export async function sendTestOrderMessage(orderId: string, actorId: string): Promise<ActionResult> {
  const bot = readBotConfig();
  if (!bot) return { ok: false, code: "no_token", message: botDiagnosisMessage(diagnoseBotConfig()) ?? NO_TOKEN_MESSAGE };
  const data = await getOrderNotificationData(orderId);
  if (!data) throw new NotFoundError("Order tidak ditemukan.");
  const route = await resolveOrderDestination(orderId);
  if (route.status !== "pending" || !route.chatId) return { ok: false, code: "no_destination", message: route.reason === SKIP_REASON.event_disabled ? route.reason : NO_DESTINATION_RESEND_MESSAGE };
  const target = route.configId ? await currentChannel(route.configId) : null;
  const r = await sendTelegramText(bot, route.chatId, TEST_MESSAGE_PREFIX + buildOrderMessage(data, bot.appUrl), target?.threadId ?? null);
  await recordAudit(actorId, "telegram_test_sent", { orderNumber: data.orderNumber, ok: r.ok, destination: route.destination });
  return r.ok ? { ok: true, message: "Pesan uji terkirim. Pesan ini bukan pekerjaan baru." } : { ok: false, message: r.message };
}

export type TokenCheck = { state: "valid" | "invalid" | "unavailable" | "not_configured"; message: string };

/** Periksa token dengan getMe (hanya baca). Hasil tidak memuat nilai token. */
export async function checkBotToken(): Promise<TokenCheck> {
  const bot = readBotConfig();
  if (!bot) return { state: "not_configured", message: botDiagnosisMessage(diagnoseBotConfig()) ?? "Token belum dikonfigurasi." };
  const me = await callTelegramApi<{ username?: string }>(bot, "getMe", {});
  if (me.ok) return { state: "valid", message: `Token valid. Bot: @${me.result.username ?? "tanpa-username"}.` };
  if (me.kind === "telegram" && (me.errorCode === 401 || me.errorCode === 404)) {
    return { state: "invalid", message: "Token ditolak Telegram. Periksa TELEGRAM_BOT_TOKEN di server, lalu restart server." };
  }
  return { state: "unavailable", message: describeApiFailure(me) };
}
