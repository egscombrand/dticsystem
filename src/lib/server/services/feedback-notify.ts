import "server-only";
import { escapeHtml, publicAppUrl, readBotConfig } from "@/lib/telegram";
import { NO_TOKEN_MESSAGE, sendTelegramText } from "@/lib/server/services/telegram";
import { recordAudit } from "@/lib/server/repositories/audit";
import {
  acquireFeedbackTestLock,
  channelForFeedback,
  claimDueFeedbackNotifications,
  ensureFeedbackNotificationRow,
  markFeedbackNotificationFailed,
  markFeedbackNotificationSent,
  recordFeedbackNotificationAttempt,
  recordFeedbackTestResult,
  releaseFeedbackTestLock,
} from "@/lib/server/repositories/feedback-telegram";
import { getFeedbackTicketById } from "@/lib/server/repositories/feedback";
import { FEEDBACK_IMPACT_LABEL, FEEDBACK_KIND_LABEL, FEEDBACK_PAGE_LABEL, FEEDBACK_STATUS_LABEL } from "@/lib/validation/feedback";
import { NotFoundError } from "@/lib/server/errors";

const DATE_FMT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

type FeedbackTicket = NonNullable<Awaited<ReturnType<typeof getFeedbackTicketById>>>;

function buildMessage(ticket: FeedbackTicket, { isNew }: { isNew: boolean }): string {
  const lines = [
    isNew ? `🎫 <b>TIKET BARU — DTIC NEXUS</b>` : `🎫 <b>TIKET BANTUAN & MASUKAN — DTIC NEXUS</b>`,
    ``,
    `<b>Nomor:</b> ${escapeHtml(ticket.ticketNumber)}`,
    `<b>Jenis:</b> ${escapeHtml(FEEDBACK_KIND_LABEL[ticket.kind])}`,
    `<b>Judul:</b> ${escapeHtml(ticket.title)}`,
    `<b>Pelapor:</b> ${escapeHtml(ticket.reporterName)}`,
    `<b>Halaman:</b> ${escapeHtml(FEEDBACK_PAGE_LABEL[ticket.relatedPage])}`,
  ];
  if (ticket.impact) lines.push(`<b>Dampak:</b> ${escapeHtml(FEEDBACK_IMPACT_LABEL[ticket.impact].split(" — ")[0])}`);
  if (ticket.relatedOrderNumber) lines.push(`<b>ID Request:</b> ${escapeHtml(ticket.relatedOrderNumber)}`);
  lines.push(`<b>Status:</b> ${escapeHtml(FEEDBACK_STATUS_LABEL[ticket.status])}`);
  lines.push(`<b>Waktu:</b> ${escapeHtml(DATE_FMT.format(new Date(ticket.createdAt)))}`);
  lines.push(``, isNew ? `Laporan baru telah masuk ke DTIC Nexus.` : `Dikelola melalui dashboard Super Admin DTIC Nexus.`, ``);
  const base = publicAppUrl(process.env);
  lines.push(
    base
      ? `Buka detail: <a href="${escapeHtml(`${base}/dtic/settings/feedback/${ticket.id}`)}">${escapeHtml(ticket.ticketNumber)}</a>`
      : `Silakan buka dashboard Super Admin untuk melihat detail dan menindaklanjuti tiket.`,
  );
  return lines.join("\n");
}

/**
 * Proses antrean notifikasi tiket yang jatuh tempo — dipanggil dari TICK worker Telegram yang sudah ada
 * (lihat telegram-worker.ts), bukan worker terpisah. Kegagalan kirim TIDAK PERNAH menghapus/membatalkan
 * tiket (tiket sudah tersimpan sebelum baris ini pernah dibuat — lihat insertFeedbackTicket). Satu baris
 * per tiket (unique ticket_id) mencegah notifikasi ganda walau tick tumpang tindih atau diproses ulang.
 */
export async function processFeedbackNotifications(limit = 10): Promise<number> {
  const bot = readBotConfig();
  if (!bot) return 0;
  const channel = await channelForFeedback();
  const claims = await claimDueFeedbackNotifications(limit);
  for (const claim of claims) {
    if (!channel || !channel.isActive || channel.verificationStatus !== "verified") {
      await markFeedbackNotificationFailed(claim.id, claim.attempts, "Grup Telegram Tim IT belum aktif/terverifikasi.");
      continue;
    }
    const ticket = await getFeedbackTicketById(claim.ticketId);
    if (!ticket) {
      await markFeedbackNotificationFailed(claim.id, claim.attempts, "Tiket tidak ditemukan.");
      continue;
    }
    const r = await sendTelegramText(bot, channel.chatId, buildMessage(ticket, { isNew: true }), channel.threadId);
    if (r.ok) await markFeedbackNotificationSent(claim.id);
    else await markFeedbackNotificationFailed(claim.id, claim.attempts, r.message);
    await recordFeedbackNotificationAttempt(claim.ticketId, { kind: "auto", status: r.ok ? "sent" : "failed", error: r.ok ? null : r.message });
  }
  return claims.length;
}

/**
 * Kirim (atau kirim ulang) notifikasi untuk SATU tiket sekarang juga, dipicu tombol "Kirim ke Telegram"
 * pada halaman detail tiket (Super Admin). Hasilnya SELALU respons Telegram yang sebenarnya — tidak pernah
 * ditandai berhasil sebelum Bot API mengonfirmasi. Tiket lama dari sebelum fitur ini ada (tanpa baris
 * antrean sama sekali) tetap bisa dikirim: baris dibuat saat itu juga (lihat ensureFeedbackNotificationRow).
 */
export async function sendFeedbackNotificationManually(ticketId: string, actor: { userId: string; name: string }): Promise<{ ok: boolean; message: string }> {
  const ticket = await getFeedbackTicketById(ticketId);
  if (!ticket) throw new NotFoundError("Tiket tidak ditemukan.");
  const row = await ensureFeedbackNotificationRow(ticketId);

  const bot = readBotConfig();
  if (!bot) {
    await markFeedbackNotificationFailed(row.id, row.attempts, NO_TOKEN_MESSAGE);
    await recordFeedbackNotificationAttempt(ticketId, { kind: "manual", status: "failed", actorUserId: actor.userId, actorName: actor.name, error: NO_TOKEN_MESSAGE });
    return { ok: false, message: NO_TOKEN_MESSAGE };
  }
  const channel = await channelForFeedback();
  if (!channel || !channel.isActive || channel.verificationStatus !== "verified") {
    const message = "Grup Telegram Tim IT belum aktif/terverifikasi. Hubungkan grup pada halaman Integrasi Telegram.";
    await markFeedbackNotificationFailed(row.id, row.attempts, message);
    await recordFeedbackNotificationAttempt(ticketId, { kind: "manual", status: "failed", actorUserId: actor.userId, actorName: actor.name, error: message });
    return { ok: false, message };
  }

  const r = await sendTelegramText(bot, channel.chatId, buildMessage(ticket, { isNew: false }), channel.threadId);
  const message = r.ok ? "Notifikasi berhasil dikirim ke Telegram." : r.message;
  if (r.ok) await markFeedbackNotificationSent(row.id);
  else await markFeedbackNotificationFailed(row.id, row.attempts, message);
  await recordFeedbackNotificationAttempt(ticketId, { kind: "manual", status: r.ok ? "sent" : "failed", actorUserId: actor.userId, actorName: actor.name, error: r.ok ? null : message });
  await recordAudit(actor.userId, "feedback_notification_sent_manually", { ticketId, ticketNumber: ticket.ticketNumber, ok: r.ok });
  return { ok: r.ok, message };
}

/**
 * Tes pesan untuk grup Tim IT (Super Admin). Hanya untuk grup yang sudah terverifikasi; tidak membuat
 * tiket atau antrean. Klik ganda ditahan oleh kunci singkat (pola identik testBrandChannel).
 */
export async function testFeedbackChannel(actorId: string): Promise<{ ok: boolean; busy?: boolean; message: string }> {
  const bot = readBotConfig();
  if (!bot) return { ok: false, message: NO_TOKEN_MESSAGE };
  const channel = await channelForFeedback();
  if (!channel) throw new NotFoundError("Grup Telegram Tim IT belum dibuat.");
  if (channel.verificationStatus !== "verified") return { ok: false, message: "Verifikasi grup terlebih dahulu sebelum tes pesan." };
  if (!(await acquireFeedbackTestLock())) {
    return { ok: false, busy: true, message: "Tes pesan baru saja dijalankan. Tunggu sebentar sebelum mencoba lagi." };
  }
  try {
    const text = "✅ Tes koneksi DTIC Connect berhasil. Grup ini terhubung untuk notifikasi tiket Bantuan & Masukan.\nPesan ini bukan tiket baru.";
    const r = await sendTelegramText(bot, channel.chatId, text, channel.threadId);
    const botNoAccess = !r.ok && (r.errorCode === 403 || r.errorCode === 400);
    const message = r.ok ? "Pesan tes terkirim ke grup." : r.message;
    await recordFeedbackTestResult({ ok: r.ok, message });
    await recordAudit(actorId, "telegram_brand_tested", { brand: "Bantuan & Masukan (Tim IT)", ok: r.ok });
    if (r.ok) return { ok: true, message: "Pesan tes terkirim ke grup. Pesan ini bukan tiket baru." };
    return {
      ok: false,
      message: botNoAccess ? `${message} Pastikan bot masih menjadi anggota grup dan memiliki izin mengirim pesan, lalu verifikasi ulang.` : message,
    };
  } finally {
    await releaseFeedbackTestLock();
  }
}
