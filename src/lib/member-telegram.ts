/**
 * Identitas Telegram anggota DTIC (MURNI: tanpa database/jaringan; dipakai server, UI, dan tes).
 *
 * Aturan:
 * - Username disimpan tanpa "@" dan huruf kecil. Username tidak wajib.
 * - Nama Telegram wajib hanya bila anggota memiliki data Telegram (username atau User ID).
 * - Status hanya "terdata" (recorded) atau "belum dihubungkan" (not_linked). Status "verified" tidak pernah
 *   diberikan otomatis: belum ada mekanisme verifikasi. Mengisi nama/username manual TIDAK berarti terverifikasi.
 */

export const TELEGRAM_STATUSES = ["not_linked", "recorded", "verified"] as const;
export type TelegramStatus = (typeof TELEGRAM_STATUSES)[number];

export const TELEGRAM_STATUS_LABEL: Record<TelegramStatus, string> = {
  not_linked: "Belum dihubungkan",
  recorded: "Terdata",
  verified: "Terverifikasi",
};

const USERNAME_RE = /^[a-z][a-z0-9_]{4,31}$/;
const USER_ID_RE = /^[1-9][0-9]{0,19}$/;

/** "@Andi_Design " → "andi_design". Kosong → null. Format salah → "invalid". */
export function normalizeTelegramUsername(input: string | null | undefined): string | null | "invalid" {
  const v = (input ?? "").trim().replace(/^@+/, "").toLowerCase();
  if (v === "") return null;
  return USERNAME_RE.test(v) ? v : "invalid";
}

/** ID numerik pengguna. Kosong → null (belum diketahui). Format salah → "invalid". */
export function normalizeTelegramUserId(input: string | null | undefined): string | null | "invalid" {
  const v = (input ?? "").trim();
  if (v === "") return null;
  return USER_ID_RE.test(v) ? v : "invalid";
}

export function deriveTelegramStatus(data: { displayName: string | null; username: string | null; userId: string | null }): "not_linked" | "recorded" {
  return data.displayName || data.username || data.userId ? "recorded" : "not_linked";
}

/** Nama Telegram wajib bila ada data Telegram lain. Mengembalikan pesan galat atau null. */
export function telegramNameRequirement(data: { displayName: string | null; username: string | null; userId: string | null }): string | null {
  if (!data.displayName && (data.username || data.userId)) return "Isi Nama Telegram bila anggota memiliki username atau User ID Telegram.";
  return null;
}

/**
 * Referensi Telegram yang boleh dipakai untuk PIC (tahap ini: hanya struktur, tanpa mention palsu).
 * - "user_id"  : hanya bila status verified dan User ID ada (mention langsung boleh).
 * - "username" : tampilkan @username sebagai informasi; JANGAN dijamin menghasilkan mention.
 * - "name"     : tampilkan Nama Telegram saja, tanpa tautan mention.
 * - "fallback" : belum ada data Telegram → nama anggota dari DTIC Connect.
 * User ID tidak pernah ditebak dari username atau nama.
 */
export type PicTelegramRef =
  | { mode: "user_id"; userId: string; label: string }
  | { mode: "username"; username: string; label: string }
  | { mode: "name"; label: string }
  | { mode: "fallback"; label: string };

export function pickTelegramRef(m: { fullName: string; displayName: string | null; username: string | null; userId: string | null; status: TelegramStatus }): PicTelegramRef {
  if (m.status === "verified" && m.userId) return { mode: "user_id", userId: m.userId, label: m.displayName ?? m.fullName };
  if (m.username) return { mode: "username", username: m.username, label: `@${m.username}` };
  if (m.displayName) return { mode: "name", label: m.displayName };
  return { mode: "fallback", label: m.fullName };
}
