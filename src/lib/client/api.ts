import type { FieldErrors } from "@/lib/validation/common";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fieldErrors?: FieldErrors,
  ) {
    super(message);
  }
}

/** Panggil endpoint internal (JSON). Header X-DTIC-Request wajib untuk proteksi CSRF. */
export async function internalRequest<T = unknown>(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "X-DTIC-Request": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Tidak dapat terhubung ke server. Periksa koneksi internet Anda.", 0);
  }
  let data: { error?: string; fieldErrors?: FieldErrors } & Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    // respons non-JSON
  }
  if (!res.ok) throw new ApiError(data.error ?? `Permintaan gagal (HTTP ${res.status}).`, res.status, data.fieldErrors);
  return data as T;
}

/**
 * Aksi internal yang hasilnya ditampilkan apa adanya (mis. kirim ulang Telegram): backend mengembalikan
 * { ok, message } baik saat sukses maupun gagal. Galat jaringan dilaporkan sebagai gagal (tanpa detail teknis).
 */
export type ActionOutcome = { ok: boolean; message: string; code?: string };

export async function internalAction(url: string, method: "POST" | "DELETE", body?: unknown): Promise<ActionOutcome> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "X-DTIC-Request": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string; code?: unknown };
    const message = data.message ?? data.error ?? `Permintaan gagal (HTTP ${res.status}).`;
    return { ok: res.ok && data.ok !== false, message, code: typeof data.code === "string" ? data.code : undefined };
  } catch {
    return { ok: false, message: "Tidak dapat terhubung ke server. Periksa koneksi Anda lalu coba lagi." };
  }
}

/** Pratinjau pesan Telegram (GET, hanya membaca). */
/** Pratinjau: token dan tujuan dilaporkan terpisah (lihat previewOrderMessage). */
export type TelegramPreview = {
  text: string;
  tokenConfigured: boolean;
  tokenProblem: string | null;
  destination: { kind: "global" | "none"; brandName: string | null; reason: string | null };
};

export async function internalPreview(url: string): Promise<TelegramPreview | { error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as Partial<TelegramPreview> & { error?: string };
    if (!res.ok || typeof data.text !== "string" || !data.destination) return { error: data.error ?? `Pratinjau gagal (HTTP ${res.status}).` };
    return { text: data.text, tokenConfigured: Boolean(data.tokenConfigured), tokenProblem: data.tokenProblem ?? null, destination: data.destination };
  } catch {
    return { error: "Tidak dapat memuat pratinjau. Periksa koneksi Anda." };
  }
}
