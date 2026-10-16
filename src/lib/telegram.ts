/**
 * Logika Telegram yang MURNI (tanpa database, tanpa jaringan) — dipakai server dan diuji unit.
 * Token bot hanya dibaca dari environment server; tidak pernah masuk ke pesan, log, atau respons.
 */
import { formatDateTime, formatDeadline } from "@/lib/dates";
import { pickTelegramRef, type TelegramStatus } from "@/lib/member-telegram";
import { STATUS_META, statusLabel, type OrderStatus } from "@/lib/status";

export type TelegramConfig = { token: string; chatId: string; apiBase: string; appUrl: string | null };
/** Konfigurasi bot (token & API). Chat tujuan TIDAK berasal dari sini: setiap brand punya grupnya sendiri. */
export type BotConfig = { token: string; apiBase: string; appUrl: string | null };

const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,})$/;
const DEFAULT_API = "https://api.telegram.org";

/**
 * Konfigurasi dari environment. Null = belum dikonfigurasi (atau nilai tidak valid).
 * TELEGRAM_API_BASE hanya untuk pengujian: hanya https atau http loopback yang diterima.
 */
export function readTelegramConfig(env: Record<string, string | undefined> = process.env): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = env.TELEGRAM_CHAT_ID?.trim() ?? "";
  if (!TOKEN_RE.test(token) || !CHAT_RE.test(chatId)) return null;
  const apiBase = (env.TELEGRAM_API_BASE?.trim() || DEFAULT_API).replace(/\/+$/, "");
  if (!/^https:\/\//.test(apiBase) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiBase)) return null;
  return { token, chatId, apiBase, appUrl: publicAppUrl(env) };
}

export type BotDiagnosis =
  | { status: "ok" }
  | { status: "missing" } // TELEGRAM_BOT_TOKEN kosong / tidak ada
  | { status: "invalid_format" } // ada, tetapi bukan format token BotFather
  | { status: "invalid_api_base" }; // TELEGRAM_API_BASE tidak diizinkan

/** Penyebab pasti token/API tidak siap. Nilai token tidak pernah dikembalikan. */
export function diagnoseBotConfig(env: Record<string, string | undefined> = process.env): BotDiagnosis {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  if (!token) return { status: "missing" };
  if (!TOKEN_RE.test(token)) return { status: "invalid_format" };
  const apiBase = (env.TELEGRAM_API_BASE?.trim() || DEFAULT_API).replace(/\/+$/, "");
  if (!/^https:\/\//.test(apiBase) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiBase)) return { status: "invalid_api_base" };
  return { status: "ok" };
}

/** Konfigurasi bot saja (token dari environment). Null bila token atau API base tidak valid. */
export function readBotConfig(env: Record<string, string | undefined> = process.env): BotConfig | null {
  if (diagnoseBotConfig(env).status !== "ok") return null;
  const token = env.TELEGRAM_BOT_TOKEN!.trim();
  const apiBase = (env.TELEGRAM_API_BASE?.trim() || DEFAULT_API).replace(/\/+$/, "");
  return { token, apiBase, appUrl: publicAppUrl(env) };
}

/** Pesan untuk pengguna dari diagnosis token. Tidak pernah memuat nilai token. */
export function botDiagnosisMessage(d: BotDiagnosis): string | null {
  if (d.status === "ok") return null;
  if (d.status === "missing") return "Token bot belum diisi di server (TELEGRAM_BOT_TOKEN). Notifikasi tidak bisa dikirim.";
  if (d.status === "invalid_format") return "TELEGRAM_BOT_TOKEN ada tetapi formatnya tidak valid. Periksa nilai token di server.";
  return "TELEGRAM_API_BASE tidak diizinkan. Gunakan https://api.telegram.org.";
}

/**
 * URL publik untuk tautan detail. Produksi harus https; localhost tidak dikirim sebagai tautan
 * operasional. Loopback hanya diizinkan di luar production (pengembangan).
 */
export function publicAppUrl(env: Record<string, string | undefined>): string | null {
  const raw = env.DTIC_APP_URL?.trim().replace(/\/+$/, "") ?? "";
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  // Penerima Telegram membuka tautan dari perangkat lain: localhost tidak pernah berguna di pesan.
  if (loopback) return null;
  return url.protocol === "https:" ? raw : null;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** PIC untuk pesan. Identitas Telegram dibaca dari menu Member DTIC (bukan dari tebakan). */
export type PicForMessage = { fullName: string; displayName: string | null; username: string | null; userId: string | null; status: TelegramStatus };

export type OrderMessageData = {
  id: string;
  orderNumber: string;
  /** Status aktual dari database. */
  status: OrderStatus;
  /** Waktu pengajuan dari database (dibuat server). */
  createdAt: Date;
  requesterName: string;
  department: string;
  brandName: string;
  /** Kategori pekerjaan = tim penanggung jawab (null untuk order lama). */
  teamName?: string | null;
  designType: string;
  title: string;
  brief: string;
  priorityName: string | null;
  deadlineAt: Date;
  attachmentCount: number;
  picInfos: PicForMessage[];
};

const BRIEF_MAX = 500;
const MESSAGE_MAX = 3800; // batas Telegram 4096 karakter; sisakan ruang untuk tag HTML
const BELUM = "Belum diisi";
const DIVIDER = "━━━━━━━━━━━━━━━━━━";

const e = (v: string | null | undefined) => (v && v.trim() ? escapeHtml(v) : BELUM);
const short = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
/** Tautan "Buka Detail Pekerjaan" (HTML). Hanya dari base URL tervalidasi dan ID pekerjaan dari database. */
const detailLink = (appUrl: string | null, id: string) =>
  appUrl ? `<a href="${escapeHtml(`${appUrl}/dtic/orders/${id}`).replace(/"/g, "&quot;")}">Buka Detail Pekerjaan</a>` : null;

/**
 * Baris PIC. Mention langsung (tg://user) HANYA bila status verified dan User ID ada; username dan nama
 * ditampilkan sebagai informasi. Tanpa data Telegram: nama anggota dari DTIC Connect.
 */
export function picLines(picks: PicForMessage[] | null | undefined): string[] {
  if (!picks || picks.length === 0) return ["• Belum ada PIC"];
  return picks.map((m) => {
    const ref = pickTelegramRef(m);
    const name = escapeHtml(m.fullName);
    if (ref.mode === "user_id") return `• <a href="tg://user?id=${ref.userId}">${escapeHtml(ref.label)}</a> (${name})`;
    if (ref.mode === "username") return `• ${name} · ${escapeHtml(ref.label)}`;
    if (ref.mode === "name") return `• ${name} · ${escapeHtml(ref.label)}`;
    return `• ${name}`;
  });
}

/**
 * Notifikasi A — request pekerjaan baru. Dibaca dari data order yang tersimpan, di-escape untuk Telegram HTML.
 * Urutan: nomor, status, judul, kategori/tim, jenis, brand, prioritas, tenggat, PIC, brief, lampiran, pemohon, lalu tindakan.
 */
export function buildOrderMessage(data: OrderMessageData, appUrl: string | null): string {
  const detail = detailLink(appUrl, data.id);
  const lines: (string | null)[] = [
    "🔔 <b>REQUEST PEKERJAAN BARU</b>",
    DIVIDER,
    "",
    `Nomor Order: <b>${escapeHtml(data.orderNumber)}</b>`,
    `Status: ${escapeHtml(STATUS_META[data.status].label.toUpperCase())}`,
    `Judul: <b>${e(data.title)}</b>`,
    ...(data.teamName ? [`Kategori / Tim: ${escapeHtml(data.teamName)}`] : []),
    `Jenis Pekerjaan: ${e(data.designType)}`,
    `Brand: ${e(data.brandName)}`,
    `Prioritas: ${e(data.priorityName)}`,
    `Tenggat: ${escapeHtml(formatDeadline(data.deadlineAt))}`,
    "",
    "👨‍💻 <b>PIC</b>",
    ...picLines(data.picInfos),
    "",
    "📝 <b>BRIEF PEKERJAAN</b>",
    e(short(data.brief, BRIEF_MAX)),
    "",
    `📎 Lampiran: ${data.attachmentCount > 0 ? `${data.attachmentCount} file` : "Tidak ada"}`,
    `👤 Pemohon: ${e(data.requesterName)} · ${e(data.department)}`,
    "",
    DIVIDER,
    "📣 <b>TINDAKAN SELANJUTNYA</b>",
    detail
      ? `1. ${detail} (perlu login akun DTIC).`
      : "1. Buka sistem DTIC Connect lalu cari nomor order di atas (perlu login akun DTIC).",
    "2. Periksa brief, tenggat, dan lampiran.",
    "3. Mulai pengerjaan sesuai status dan alur kerja yang berlaku.",
    "",
    "DTIC Nexus · Notifikasi Otomatis",
  ];
  // Nomor order selalu di bagian atas; pemotongan hanya memangkas bagian bawah.
  return lines.filter((l): l is string => l !== null).join("\n").slice(0, MESSAGE_MAX);
}

export type PicChangeMessageData = {
  orderId: string;
  orderNumber: string;
  title: string;
  operation: "add" | "remove" | "replace" | "move" | null;
  teamName: string | null;
  before: string[];
  after: string[];
  added: PicForMessage[];
  removed: string[];
  reason: string | null;
  actorName: string | null;
  changedAt: Date;
};

const bullets = (list: string[]) => (list.length ? list.map((n) => `• ${escapeHtml(n)}`) : ["• —"]);

export const PIC_OPERATION_LABEL: Record<NonNullable<PicChangeMessageData["operation"]>, string> = {
  add: "Penambahan PIC",
  replace: "Penggantian PIC",
  move: "Pemindahan Pekerjaan",
  remove: "Penghapusan PIC",
};

/**
 * Notifikasi C — perubahan PIC oleh Manager/Super Admin. Jelas berbeda dari request baru (judul pesan, tanpa
 * deskripsi/brief) agar tidak dibaca sebagai penugasan awal. Anggota yang ditambahkan disebut (mention bila terverifikasi).
 */
export function buildPicChangeMessage(data: PicChangeMessageData, appUrl: string | null): string {
  const op = data.operation ? PIC_OPERATION_LABEL[data.operation] : "Perubahan PIC";
  const lines: (string | null)[] = [
    "🔁 <b>PERUBAHAN DISTRIBUSI PEKERJAAN — DTIC CONNECT</b>",
    DIVIDER,
    "",
    `Nomor Pekerjaan: ${escapeHtml(data.orderNumber)}`,
    `Judul: <b>${e(data.title)}</b>`,
    data.teamName ? `Kategori: ${escapeHtml(data.teamName)}` : null,
    `Operasi: ${escapeHtml(op)}`,
    data.operation === "add" ? "PIC lama tetap ditugaskan." : null,
    "",
    "PIC Sebelumnya:",
    ...bullets(data.before),
    "",
    "PIC Setelah Perubahan:",
    ...bullets(data.after),
    ...(data.operation === "move" && data.removed.length ? ["", `PIC dilepas: ${data.removed.map((n) => escapeHtml(n)).join(", ")}`] : []),
    ...(data.added.length ? ["", data.operation === "move" ? "PIC penerima pekerjaan:" : "PIC ditambahkan:", ...picLines(data.added)] : []),
    ...(data.operation !== "move" && data.removed.length ? ["", `PIC dilepas: ${data.removed.map((n) => escapeHtml(n)).join(", ")}`] : []),
    "",
    data.actorName ? `Diubah oleh: ${escapeHtml(data.actorName)}` : null,
    data.reason?.trim() ? `Alasan: ${escapeHtml(short(data.reason, BRIEF_MAX))}` : null,
    `Waktu Perubahan: ${escapeHtml(formatDateTime(data.changedAt))}`,
    "",
    appUrl ? `Lihat Pekerjaan: ${escapeHtml(`${appUrl}/dtic/orders/${data.orderId}`)}` : null,
    DIVIDER,
    "Ini pembaruan penugasan pada pekerjaan yang sudah ada, bukan request baru.",
    "",
    "DTIC Nexus · Notifikasi Otomatis",
  ];
  return lines.filter((l): l is string => l !== null).join("\n").slice(0, MESSAGE_MAX);
}

export type StatusMessageData = {
  orderId: string;
  orderNumber: string;
  title: string;
  previousStatus: string | null;
  newStatus: string;
  changedAt: Date;
  note: string | null;
  actorName: string | null;
  picInfos: PicForMessage[];
};

/** Notifikasi B — perubahan status pekerjaan. Informasi pemantauan; tidak memicu penugasan apa pun. */
export function buildStatusMessage(data: StatusMessageData, appUrl: string | null): string {
  const lines: (string | null)[] = [
    "🔄 <b>PEMBARUAN STATUS PEKERJAAN</b>",
    DIVIDER,
    "",
    `Nomor Order: ${escapeHtml(data.orderNumber)}`,
    `Judul: ${e(data.title)}`,
    "",
    `Status sebelumnya: ${escapeHtml(data.previousStatus ? statusLabel(data.previousStatus) : "—")}`,
    `Status baru: <b>${escapeHtml(statusLabel(data.newStatus).toUpperCase())}</b>`,
    `Waktu: ${escapeHtml(formatDateTime(data.changedAt))}`,
    data.actorName ? `Diubah oleh: ${escapeHtml(data.actorName)}` : null,
    data.note?.trim() ? `Catatan: ${escapeHtml(short(data.note, BRIEF_MAX))}` : null,
    "",
    "👨‍💻 <b>PETUGAS</b>",
    ...picLines(data.picInfos),
    "",
    detailLink(appUrl, data.orderId),
    DIVIDER,
    "DTIC Nexus · Notifikasi Otomatis",
  ];
  return lines.filter((l): l is string => l !== null).join("\n").slice(0, MESSAGE_MAX);
}

/**
 * Deskripsi galat dari Telegram, disaring agar tidak memuat token atau URL.
 * Format token (angka:huruf) dan URL diganti; panjang dibatasi.
 */
export function sanitizeTelegramDescription(description: string): string {
  return description
    .replace(/\d{5,}:[A-Za-z0-9_-]{20,}/g, "[token disembunyikan]")
    .replace(/https?:\/\/\S+/g, "[url disembunyikan]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/**
 * Pesan galat yang AMAN dan spesifik, dibangun dari respons API Telegram yang sebenarnya
 * (error_code + description). Token tidak pernah ikut; description hanya dicocokkan lalu disaring.
 */
export function telegramErrorMessage(errorCode: number, description = ""): string {
  // Status 0 bukan kode Telegram (galat transport). Jangan pernah dilabeli sebagai penolakan Telegram.
  if (!Number.isInteger(errorCode) || errorCode <= 0) return "Tidak dapat terhubung ke Telegram. Tidak ada respons yang diterima.";
  const raw = sanitizeTelegramDescription(description);
  const d = description.toLowerCase();
  const detail = raw ? ` Respons Telegram: ${errorCode} ${raw}.` : ` Respons Telegram: ${errorCode}.`;
  if (errorCode === 400 && d.includes("message thread not found")) {
    return `Topik Telegram tidak ditemukan. Di grup, klik kanan topik → Copy Link, tempel link topik itu, lalu verifikasi ulang.${detail}`;
  }
  if (errorCode === 401) return `Token bot ditolak (401 Unauthorized). Periksa TELEGRAM_BOT_TOKEN; token lama yang di-revoke tidak berlaku.${detail}`;
  if (errorCode === 404) return `Token bot tidak dikenali (404). Periksa TELEGRAM_BOT_TOKEN.${detail}`;
  if (errorCode === 400 && (d.includes("chat not found") || d.includes("chat_id is empty"))) {
    return `Chat tujuan tidak ditemukan (400 chat not found). Verifikasi ulang link grup di Integrasi Telegram. Untuk chat pribadi, pastikan pengguna sudah mengirim /start ke bot.${detail}`;
  }
  if (errorCode === 403 && /can't send messages to (the )?bots?\b/.test(d)) {
    return `Chat ID mengarah ke bot, bukan ke tujuan pesan. Ambil chat ID tujuan dari getUpdates (chat.id), lalu verifikasi ulang link di Integrasi Telegram.${detail}`;
  }
  if (errorCode === 403 && d.includes("blocked by the user")) {
    return `Bot diblokir oleh pengguna di chat ini. Buka bot, tekan Unblock atau Restart, lalu coba lagi.${detail}`;
  }
  if (errorCode === 403 && d.includes("can't initiate conversation")) {
    return `Pengguna belum memulai percakapan dengan bot. Buka bot dan kirim /start, lalu coba lagi.${detail}`;
  }
  if (errorCode === 403 && (d.includes("not enough rights") || d.includes("not a member") || d.includes("was kicked") || d.includes("can't send"))) {
    return `Bot tidak punya izin mengirim pesan di grup/kanal tujuan. Pastikan bot anggota grup dan (untuk kanal) menjadi admin.${detail}`;
  }
  if (errorCode === 429) return `Telegram membatasi permintaan sementara. Akan dicoba lagi.${detail}`;
  if (errorCode >= 500) return `Layanan Telegram sedang bermasalah. Akan dicoba lagi.${detail}`;
  if (errorCode === 403) return `Telegram menolak pengiriman (403 Forbidden).${detail}`;
  return `Telegram menolak permintaan (${errorCode}).${detail}`;
}

export const TELEGRAM_TIMEOUT_MS = 8000;

/** Awalan pesan uji: wajib tampil agar pesan uji tidak dikira pengajuan atau pekerjaan baru. */
export const TEST_MESSAGE_PREFIX = "🧪 <b>PESAN UJI — BUKAN PEKERJAAN BARU</b>\nPesan ini hanya untuk menguji format dan koneksi. Data order tidak berubah.\n\n";

/** Teks biasa dari HTML Telegram (untuk pratinjau di browser). Entitas dikembalikan ke karakter asli. */
export function telegramHtmlToText(html: string): string {
  return html
    .replace(/<a [^>]*>/g, "")
    .replace(/<\/a>/g, "")
    .replace(/<\/?b>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
