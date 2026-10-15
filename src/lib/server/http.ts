import "server-only";
import { AppError } from "@/lib/server/errors";
import { DatabaseNotConfiguredError } from "@/lib/server/db";
import { diagnoseDbError } from "@/lib/server/db-diagnostics";

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

/** Ubah error menjadi respons JSON tanpa membocorkan detail internal/secret. */
export function errorResponse(error: unknown, context: string) {
  if (error instanceof AppError) {
    return json({ error: error.message, fieldErrors: error.fieldErrors }, error.status);
  }
  if (error instanceof DatabaseNotConfiguredError) {
    console.error(`[${context}]`, error.message);
    return json({ error: "Layanan belum dikonfigurasi. Hubungi tim DTIC." }, 503);
  }
  const hint = diagnoseDbError(error);
  if (hint) {
    console.error(`[${context}] [database] ${hint}`);
    return json({ error: "Database sedang tidak dapat dihubungi. Data tidak tersimpan, silakan coba lagi nanti." }, 503);
  }
  console.error(`[${context}]`, error);
  return json({ error: "Terjadi kesalahan pada server. Data tidak tersimpan, silakan coba lagi." }, 500);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("Format permintaan tidak valid.", 400);
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(id: string, what = "Data") {
  if (!UUID_RE.test(id)) throw new AppError(`${what} tidak ditemukan.`, 404);
}

/**
 * Proteksi CSRF untuk endpoint yang mengubah data: browser lain (origin berbeda)
 * tidak boleh memicu mutasi. Mutasi internal juga wajib header X-DTIC-Request.
 */
export function assertSameOrigin(request: Request, opts: { requireCustomHeader?: boolean } = {}) {
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!host || originHost !== host) throw new AppError("Permintaan lintas situs ditolak.", 403);
  }
  if (opts.requireCustomHeader && request.headers.get("x-dtic-request") !== "1") {
    throw new AppError("Permintaan tidak valid.", 403);
  }
}
