import "server-only";
import postgres from "postgres";
import { poolMax } from "@/lib/server/pool-config";

/**
 * Koneksi Postgres (Supabase) — HANYA di server. DATABASE_URL tidak pernah
 * dikirim ke browser (tanpa prefix NEXT_PUBLIC_).
 */
declare global {
  var __dticSqlPool: { url: string; client: postgres.Sql } | undefined;
  /** Bentuk lama (sebelum pool mengikuti DATABASE_URL); hanya dibersihkan bila masih ada saat HMR. */
  var __dticSql: unknown;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL belum dikonfigurasi.");
    this.name = "DatabaseNotConfiguredError";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * SSL: hormati `?sslmode=` pada URL bila ada. Jika tidak ada, koneksi ke host non-lokal
 * (mis. Supabase pooler) dienkripsi ("require"); host lokal (PGlite/dev) tanpa SSL.
 */
function sslOption(url: string): { ssl?: "require" | false } {
  try {
    const u = new URL(url);
    if (u.searchParams.has("sslmode") || u.searchParams.has("ssl")) return {};
    return { ssl: LOCAL_HOSTS.has(u.hostname) ? false : "require" };
  } catch {
    return {};
  }
}

function createClient(url: string): postgres.Sql {
  return postgres(url, {
    ...sslOption(url),
    max: poolMax(process.env.DB_POOL_MAX),
    idle_timeout: 20,
    connect_timeout: 10,
    // Kompatibel dengan Supabase transaction pooler (pgbouncer)
    prepare: false,
    types: {
      // bigint (file_size, count) → number
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
    onnotice: () => {},
  });
}

function closeQuietly(client: unknown) {
  const end = (client as { end?: (o: { timeout: number }) => Promise<void> } | null)?.end;
  if (typeof end === "function") void end.call(client, { timeout: 5 }).catch(() => {});
}

/**
 * Satu pool per proses (disimpan di globalThis agar HMR dev tidak membuka pool baru).
 * Bila DATABASE_URL berubah (mis. .env diedit saat `next dev` berjalan), pool lama ditutup
 * dan pool baru dibuat — sehingga nilai env terbaru benar-benar dipakai.
 */
export function sql(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseNotConfiguredError();
  const cached = globalThis.__dticSqlPool;
  if (cached && cached.url === url) return cached.client;
  if (cached) closeQuietly(cached.client);
  if (globalThis.__dticSql) {
    closeQuietly(globalThis.__dticSql);
    globalThis.__dticSql = undefined;
  }
  const client = createClient(url);
  globalThis.__dticSqlPool = { url, client };
  return client;
}
