/**
 * Kebijakan retry notifikasi Telegram (Murni: tanpa database/jaringan; diuji unit).
 *
 * - Maksimal 5 percobaan (termasuk yang pertama). Jadwal jeda sebelum percobaan 2..5: 3, 10, 30, 60 detik.
 * - Galat sementara (timeout, jaringan, 429, 5xx) diulang. Galat permanen (token/chat/izin salah) tidak diulang.
 * - 429 mengikuti `retry_after` dari Telegram bila ada (diambil yang lebih lama dari jadwal).
 */

export const MAX_ATTEMPTS = 5;
const DEFAULT_DELAYS_SECONDS = [3, 10, 30, 60];

/** Jadwal dapat diubah lewat env (mis. untuk pengujian). Nilai tidak valid → jadwal default. */
export function retryDelaysSeconds(env: Record<string, string | undefined> = process.env): number[] {
  const raw = env.TELEGRAM_RETRY_DELAYS_SECONDS?.trim();
  if (!raw) return DEFAULT_DELAYS_SECONDS;
  const parts = raw.split(",").map((p) => Number(p.trim()));
  const valid = parts.length === MAX_ATTEMPTS - 1 && parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 3600);
  return valid ? parts : DEFAULT_DELAYS_SECONDS;
}

/** Jeda sebelum percobaan berikutnya, setelah `attemptsDone` percobaan. Null bila sudah habis. */
export function delayAfterAttempt(attemptsDone: number, delays: number[] = DEFAULT_DELAYS_SECONDS): number | null {
  if (attemptsDone < 1 || attemptsDone >= MAX_ATTEMPTS) return null;
  return delays[attemptsDone - 1] ?? null;
}

export type FailureKind = "transient" | "permanent";

/** Klasifikasi galat dari respons Telegram atau kegagalan jaringan. */
export function classifyFailure(input: { network?: boolean; errorCode?: number; retryAfterSeconds?: number }): FailureKind {
  if (input.network) return "transient";
  const code = input.errorCode ?? 0;
  if (code === 429 || code >= 500) return "transient";
  return "permanent";
}

export type RetryDecision =
  | { status: "sent" }
  | { status: "failed"; errorKind: FailureKind }
  | { status: "retrying"; errorKind: "transient"; delaySeconds: number };

/**
 * Keputusan status setelah satu percobaan.
 * `attemptsDone` sudah termasuk percobaan yang baru saja selesai.
 */
export function decideAfterAttempt(args: {
  ok: boolean;
  attemptsDone: number;
  kind?: FailureKind;
  retryAfterSeconds?: number;
  delays?: number[];
}): RetryDecision {
  if (args.ok) return { status: "sent" };
  if (args.kind !== "transient") return { status: "failed", errorKind: "permanent" };
  const scheduled = delayAfterAttempt(args.attemptsDone, args.delays);
  if (scheduled === null) return { status: "failed", errorKind: "transient" };
  const delay = Math.max(scheduled, args.retryAfterSeconds ?? 0);
  return { status: "retrying", errorKind: "transient", delaySeconds: delay };
}
