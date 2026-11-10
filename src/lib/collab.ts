/**
 * Order Collaboration — logika murni (tanpa database/jaringan), dipakai server dan browser, diuji unit.
 * Lihat migrasi 20261110000000_order_collaboration.sql untuk model datanya.
 */
import type { RichDoc } from "@/lib/rich-text";

/** Batas dirancang di bawah batas badan permintaan fungsi serverless (≈4,5 MB di Vercel), bukan UPLOAD_LIMITS penuh. */
export const COLLAB_LIMITS = {
  messageMaxChars: 2000,
  chatMaxFiles: 3,
  chatMaxBytesPerMessage: 4 * 1024 * 1024,
  chatMaxAttachmentsPerOrder: 40,
  referenceMaxFiles: 3,
  referenceMaxBytesPerUpload: 4 * 1024 * 1024,
  referenceMaxLatePerOrder: 20,
  briefReasonMaxChars: 1000,
  badgeBatchMax: 20,
} as const;

export const SENDER_KINDS = ["requester", "staff", "manager", "super_admin", "system"] as const;
export type SenderKind = (typeof SENDER_KINDS)[number];

export const SENDER_ROLE_LABEL: Record<SenderKind, string> = {
  requester: "Pemohon",
  staff: "PIC",
  manager: "Manager",
  super_admin: "Admin",
  system: "Sistem",
};

export type ChatAttachment = { id: string; fileName: string; mimeType: string; fileSize: number };
export type ChatMessage = {
  id: string;
  seq: number;
  senderKind: SenderKind;
  senderName: string;
  body: string;
  createdAt: string;
  attachments: ChatAttachment[];
};
export type ChatPage = {
  messages: ChatMessage[];
  /** seq pesan terbesar di order ini (bukan hanya halaman ini) — untuk kursor polling. */
  lastSeq: number;
  /** Kursor baca pembaca saat ini (Pemohon untuk endpoint publik). */
  lastReadSeq: number;
  /** Pesan dari pihak lain (bukan pembaca) yang belum dibaca. */
  unread: number;
  /** Nama PIC yang benar-benar ditugaskan pada order (untuk kepala ruang diskusi). */
  picNames: string[];
  closed: boolean;
};

export type BriefVersion = {
  versionNo: number;
  brief: string;
  briefRich: RichDoc | null;
  source: "original" | "requester_change" | "staff_edit";
  createdByName: string;
  createdAt: string;
};
export type BriefChangeStatus = "pending" | "accepted" | "rejected" | "withdrawn";
export type BriefChange = {
  id: string;
  basedOnVersion: number;
  proposedBrief: string;
  proposedBriefRich: RichDoc | null;
  reason: string;
  requestedByName: string;
  status: BriefChangeStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  resultingVersionNo: number | null;
  createdAt: string;
};
export const BRIEF_CHANGE_LABEL: Record<BriefChangeStatus, string> = {
  pending: "Menunggu keputusan PIC",
  accepted: "Diterima",
  rejected: "Ditolak",
  withdrawn: "Ditarik",
};

export type ReferenceFile = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  /** true = diunggah Pemohon setelah pengajuan (bukan lampiran pengajuan awal). */
  addedLater: boolean;
  uploadedByName: string | null;
};

export type ActivityKind =
  | "created" | "assigned" | "status" | "message" | "reference" | "brief_change" | "deadline" | "delivery" | "decision" | "review" | "sla";
export type ActivityItem = { key: string; at: string; kind: ActivityKind; label: string; actor: string | null; detail: string | null };

/** Penanda perhatian per order (halaman Riwayat Request: "Request saya"). Hanya angka & flag kecil. */
export type OrderBadges = {
  orderNumber: string;
  status: string;
  unreadMessages: number;
  awaitingDeadline: boolean;
  newResults: number;
  awaitingClarification: boolean;
  briefChangePending: boolean;
};

export function badgeTotal(b: Pick<OrderBadges, "unreadMessages" | "awaitingDeadline" | "newResults" | "awaitingClarification">): number {
  return b.unreadMessages + (b.awaitingDeadline ? 1 : 0) + b.newResults + (b.awaitingClarification ? 1 : 0);
}

export function badgeLabels(b: OrderBadges): string[] {
  const out: string[] = [];
  if (b.unreadMessages > 0) out.push(`${b.unreadMessages} pesan baru`);
  if (b.awaitingDeadline) out.push("Deadline menunggu persetujuan");
  if (b.newResults > 0) out.push(b.newResults > 1 ? `${b.newResults} hasil/draft baru` : "Hasil/draft baru");
  if (b.awaitingClarification) out.push("Permintaan klarifikasi");
  return out;
}

// ---------------------------------------------------------------- pesan

/**
 * Karakter yang dibuang dari pesan: kontrol (kecuali baris baru & tab), spasi lebar-nol/penanda arah teks
 * (dipakai untuk menyamarkan teks), dan pemisah baris Unicode. Dirakit dari kode angka, bukan ditulis literal.
 */
const UNSAFE_RANGES: [number, number][] = [[0, 8], [11, 12], [14, 31], [127, 127], [0x200b, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069]];
const UNSAFE_CHARS = new RegExp(
  "[" + UNSAFE_RANGES.map(([a, b]) => String.fromCharCode(a) + (b > a ? "-" + String.fromCharCode(b) : "")).join("") + "]",
  "g",
);

/** Hilangkan karakter berbahaya/tak terlihat, rapikan baris kosong berlebihan, potong spasi tepi. */
export function normalizeMessageBody(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\r\n?/g, "\n").replace(UNSAFE_CHARS, "").replace(/\n{4,}/g, "\n\n\n").trim();
}

export type MessageProblem = { field: "body" | "attachments"; message: string };

/** Aturan yang sama dipakai browser (umpan balik cepat) dan server (otoritas). */
export function messageProblem(body: string, files: { size: number }[]): MessageProblem | null {
  if (body.length > COLLAB_LIMITS.messageMaxChars) return { field: "body", message: `Pesan maksimal ${COLLAB_LIMITS.messageMaxChars.toLocaleString("id-ID")} karakter.` };
  if (!body && files.length === 0) return { field: "body", message: "Tulis pesan atau lampirkan berkas." };
  if (files.length > COLLAB_LIMITS.chatMaxFiles) return { field: "attachments", message: `Maksimal ${COLLAB_LIMITS.chatMaxFiles} berkas per pesan.` };
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > COLLAB_LIMITS.chatMaxBytesPerMessage) return { field: "attachments", message: "Total ukuran lampiran per pesan maksimal 4 MB." };
  return null;
}

/** Gabungkan pesan baru ke daftar lama: tanpa duplikat (berdasarkan id), terurut menurut seq. */
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export function lastSeqOf(messages: ChatMessage[]): number {
  return messages.reduce((max, m) => (m.seq > max ? m.seq : max), 0);
}

/** Jumlah pesan dari pihak lain setelah kursor baca. */
export function unreadCount(messages: ChatMessage[], lastReadSeq: number, viewer: SenderKind): number {
  return messages.filter((m) => m.seq > lastReadSeq && m.senderKind !== viewer).length;
}

/** Indeks pesan pertama yang belum dibaca (untuk garis pemisah "Pesan baru"), atau -1. */
export function firstUnreadIndex(messages: ChatMessage[], lastReadSeq: number, viewer: SenderKind): number {
  return messages.findIndex((m) => m.seq > lastReadSeq && m.senderKind !== viewer);
}

const GROUP_WINDOW_MS = 15 * 60_000;

/**
 * Pesan diringkas untuk timeline aktivitas: pesan beruntun dari pengirim yang sama dalam 15 menit menjadi SATU
 * baris ("PIC Fathin mengirim 3 pesan"), supaya timeline tidak dibanjiri percakapan. Isi pesan TIDAK dimasukkan.
 */
export function groupMessageActivity(messages: Pick<ChatMessage, "id" | "senderKind" | "senderName" | "createdAt" | "attachments">[]): ActivityItem[] {
  const out: ActivityItem[] = [];
  let cur: { kind: SenderKind; name: string; firstAt: number; lastAt: number; firstIso: string; id: string; count: number; files: number } | null = null;
  const flush = () => {
    if (!cur) return;
    const who = cur.kind === "requester" ? "Pemohon" : `${SENDER_ROLE_LABEL[cur.kind]} ${cur.name}`;
    const parts = [`${cur.count} pesan`];
    if (cur.files > 0) parts.push(`${cur.files} lampiran`);
    out.push({
      key: `msg-${cur.id}`,
      at: cur.firstIso,
      kind: "message",
      label: `${who} mengirim ${parts.join(" dan ")}`,
      actor: cur.kind === "requester" ? "Pemohon" : cur.name,
      detail: null,
    });
    cur = null;
  };
  for (const m of messages) {
    const t = new Date(m.createdAt).getTime();
    if (cur && cur.kind === m.senderKind && cur.name === m.senderName && t - cur.lastAt <= GROUP_WINDOW_MS) {
      cur.count += 1;
      cur.files += m.attachments.length;
      cur.lastAt = t;
      continue;
    }
    flush();
    cur = { kind: m.senderKind, name: m.senderName, firstAt: t, lastAt: t, firstIso: m.createdAt, id: m.id, count: 1, files: m.attachments.length };
  }
  flush();
  return out;
}

/** Urutkan aktivitas menurut waktu (terlama dulu) dengan penentu urutan stabil. */
export function sortActivity(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------- brief

export type BriefChangeProblem = { field: "reason" | "briefDoc"; message: string };

/** Alasan wajib; isi usulan harus berbeda dari brief saat ini. */
export function briefChangeProblem(reason: string, proposedText: string, currentText: string): BriefChangeProblem | null {
  const r = reason.trim();
  if (r.length < 3) return { field: "reason", message: "Alasan perubahan wajib diisi (minimal 3 karakter)." };
  if (r.length > COLLAB_LIMITS.briefReasonMaxChars) return { field: "reason", message: `Alasan maksimal ${COLLAB_LIMITS.briefReasonMaxChars.toLocaleString("id-ID")} karakter.` };
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  if (norm(proposedText) === norm(currentText)) return { field: "briefDoc", message: "Isi brief belum berubah dari versi saat ini." };
  return null;
}

// ---------------------------------------------------------------- "Request saya" (nomor order yang diingat di browser)

export const MY_REQUESTS_MAX = 20;

/** Tambahkan nomor ke daftar (terbaru di depan, tanpa duplikat, dibatasi). Murni — penyimpanan ada di sisi klien. */
export function rememberOrderNumber(list: string[], orderNumber: string, max: number = MY_REQUESTS_MAX): string[] {
  const n = orderNumber.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^DTIC-\d{4}-\d{5,}$/.test(n)) return list;
  return [n, ...list.filter((x) => x !== n)].slice(0, max);
}

export function forgetOrderNumber(list: string[], orderNumber: string): string[] {
  return list.filter((x) => x !== orderNumber);
}

/** Baca daftar tersimpan dengan aman: hanya nomor berformat benar yang diterima. */
export function parseStoredOrderNumbers(raw: string | null, max: number = MY_REQUESTS_MAX): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const x of v) if (typeof x === "string" && /^DTIC-\d{4}-\d{5,}$/.test(x) && !out.includes(x)) out.push(x);
    return out.slice(0, max);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- pemisah tanggal percakapan

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });

/** Kunci hari (YYYY-MM-DD) menurut WIB — dasar mengelompokkan pesan per hari. */
export function dayKeyWib(iso: string | Date): string {
  return dayKeyFmt.format(new Date(iso));
}

/** "Hari ini" / "Kemarin" / tanggal panjang menurut WIB. `longDate` diberikan pemanggil agar fungsi ini murni. */
export function dayLabel(iso: string, now: Date, longDate: (d: string) => string): string {
  const key = dayKeyWib(iso);
  if (key === dayKeyWib(now)) return "Hari ini";
  if (key === dayKeyWib(new Date(now.getTime() - 24 * 3_600_000))) return "Kemarin";
  return longDate(iso);
}

/** Indeks pesan yang membuka hari baru (pesan pertama tiap hari). */
export function dayStartIndexes(messages: Pick<ChatMessage, "createdAt">[]): Set<number> {
  const out = new Set<number>();
  let prev = "";
  messages.forEach((m, i) => {
    const k = dayKeyWib(m.createdAt);
    if (k !== prev) out.add(i);
    prev = k;
  });
  return out;
}
