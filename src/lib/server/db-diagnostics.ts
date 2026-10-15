/**
 * Menerjemahkan error koneksi/database menjadi petunjuk yang bisa ditindaklanjuti.
 * Hanya host & port yang disebut — password/connection string tidak pernah ditampilkan.
 */

function dbTarget(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return `${u.hostname}:${u.port || "5432"}`;
  } catch {
    return "(DATABASE_URL tidak valid)";
  }
}

function isSupabaseDirectHost(): boolean {
  try {
    return /^db\.[a-z0-9]+\.supabase\.co$/i.test(new URL(process.env.DATABASE_URL ?? "").hostname);
  } catch {
    return false;
  }
}

function errCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return undefined;
}

/** Petunjuk diagnosis untuk error database, atau null bila bukan error database yang dikenali. */
export function diagnoseDbError(error: unknown): string | null {
  const code = errCode(error);
  const message = error instanceof Error ? error.message : "";
  const target = dbTarget();
  switch (code) {
    case "ENETUNREACH":
    case "EHOSTUNREACH":
    case "EADDRNOTAVAIL": {
      const ipv6 = /\b[0-9a-f]{1,4}(:[0-9a-f]{0,4}){3,7}\b/i.test(message);
      if (ipv6 && isSupabaseDirectHost())
        return `Tidak dapat menjangkau ${target} lewat IPv6 (${code}). Host direct Supabase hanya memiliki alamat IPv6, sedangkan jaringan server ini tidak mendukung IPv6. Ganti DATABASE_URL dengan connection string "Session pooler" dari Supabase Dashboard → Connect.`;
      return `Jaringan tidak dapat menjangkau ${target} (${code}). Periksa koneksi internet, firewall, dan dukungan IPv4/IPv6.`;
    }
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `Hostname database pada DATABASE_URL tidak dapat di-resolve (${code}) untuk ${target}. Periksa ejaan host dan DNS.`;
    case "ECONNREFUSED":
      return `Koneksi ke ${target} ditolak (ECONNREFUSED). Pastikan server database berjalan dan port benar.`;
    case "ETIMEDOUT":
    case "CONNECT_TIMEOUT":
      return `Koneksi ke ${target} timeout. Periksa firewall/network restriction (Supabase → Settings → Database → Network Restrictions).`;
    case "ECONNRESET":
      return `Koneksi ke ${target} terputus (ECONNRESET). Periksa batas koneksi pooler atau stabilitas jaringan.`;
    case "28P01":
    case "28000":
      return `Autentikasi database gagal untuk ${target}. Periksa username/password pada DATABASE_URL (pooler Supabase memakai username "postgres.<project-ref>").`;
    case "3D000":
      return `Nama database pada DATABASE_URL tidak ditemukan (${target}).`;
    case "42P01":
      return `Tabel tidak ditemukan di ${target}. Jalankan migration: npm run db:migrate.`;
    case "XX000":
      if (/tenant or user not found/i.test(message))
        return `Pooler Supabase menolak username (${target}). Salin ulang connection string Session pooler dari Dashboard → Connect.`;
      return null;
    default:
      return null;
  }
}
