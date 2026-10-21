import "server-only";
import { escapeHtml, readBotConfig } from "@/lib/telegram";
import { sendTelegramText } from "@/lib/server/services/telegram";
import { channelForBrand } from "@/lib/server/repositories/telegram-brands";

/**
 * Jumlah percobaan sinkronisasi GAGAL/SEBAGIAN berturut-turut (bukan murni "hari" — lihat catatan di
 * syncOrderDriveMetadata: percobaan dipicu baik oleh worker harian maupun pembukaan halaman order, jadi ini
 * sedikit lebih responsif daripada "hari kalender") sebelum eskalasi dikirim.
 */
export const ESCALATION_THRESHOLD = 3;

/**
 * Kirim satu pesan eskalasi ke grup Telegram GLOBAL (jalur yang sudah ada untuk seluruh notifikasi order —
 * lihat src/lib/telegram-routing.ts: "satu grup global untuk semua brand"). TIDAK membuat jalur notifikasi
 * baru dan tidak mengantre lewat order_outbox (pesan ini bukan tentang satu order status, melainkan
 * peringatan operasional arsip) — dikirim langsung, sama seperti sendTestNotification/testBrandChannel.
 *
 * Catatan jujur tentang keterbatasan: sistem ini TIDAK memiliki jalur DM terverifikasi ke satu petugas/PIC
 * tertentu (identitas Telegram anggota tersimpan untuk ditampilkan sebagai tautan "buka Telegram", bukan
 * untuk bot mengirim pesan langsung kepadanya — Telegram API mengharuskan pengguna itu pernah memulai obrolan
 * dengan bot, yang tidak pernah divalidasi di sistem ini). Eskalasi "petugas → admin → koordinator" per
 * aturan arsip karena itu disederhanakan menjadi SATU tahap: peringatan ke grup global yang sudah dipantau
 * tim (bukan benar-benar tiga tahap terpisah) — ini keputusan yang diambil demi tidak membangun jalur
 * notifikasi baru yang belum pernah diuji keterkirimannya.
 */
export async function sendDriveEscalationAlert(orderNumber: string, orderTitle: string, failCount: number): Promise<{ ok: boolean; message: string }> {
  const bot = readBotConfig();
  if (!bot) return { ok: false, message: "Token bot Telegram belum dikonfigurasi." };
  const channel = await channelForBrand(null);
  if (!channel || channel.verificationStatus !== "verified" || !channel.isActive) {
    return { ok: false, message: "Grup Telegram global belum aktif/terverifikasi." };
  }
  const text = [
    `⚠️ <b>Arsip Google Drive bermasalah</b>`,
    `Pekerjaan <b>${escapeHtml(orderNumber)}</b> — ${escapeHtml(orderTitle)}`,
    `Rekonsiliasi arsip gagal/sebagian ${failCount}x berturut-turut. Mohon diperiksa manual (halaman detail pekerjaan → Hasil pekerjaan).`,
  ].join("\n");
  const r = await sendTelegramText(bot, channel.chatId, text, channel.threadId);
  return { ok: r.ok, message: r.ok ? "Peringatan eskalasi terkirim ke grup global." : r.message };
}
