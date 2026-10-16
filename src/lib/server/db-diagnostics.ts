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
  // Batas klien/koneksi Supabase (session pooler): EMAXCONNSESSION atau SQLSTATE 53300 (too_many_connections).
  if (code === "53300" || code === "EMAXCONNSESSION" || /max clients reached|too many connections|EMAXCONN/i.test(message)) {
    return `Batas koneksi database tercapai di ${target} (session pooler). Turunkan DB_POOL_MAX ke 1 di environment ini, dan pertimbangkan Transaction Pooler (port 6543) bila jumlah instance serverless besar.`;
  }
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
    // Transaksi gagal karena kondisi SEMENTARA (lock bentrok dengan transaksi lain, mis. migrasi yang
    // sedang berjalan, atau permintaan serupa yang diproses bersamaan) — bukan bug logika. Aman diulang.
    case "40P01": // deadlock_detected
      return `Transaksi database bentrok dengan transaksi lain (deadlock) di ${target}. Perubahan belum tersimpan; silakan coba lagi.`;
    case "40001": // serialization_failure
      return `Transaksi database gagal karena pembaruan bersamaan di ${target}. Perubahan belum tersimpan; silakan coba lagi.`;
    case "55P03": // lock_not_available
      return `Data sedang dikunci oleh proses lain di ${target} (mis. migrasi yang sedang berjalan). Perubahan belum tersimpan; coba lagi sesaat lagi.`;
    case "57014": // query_canceled (mis. menunggu lock melewati batas waktu)
      return `Permintaan database dibatalkan karena menunggu terlalu lama di ${target}. Perubahan belum tersimpan; silakan coba lagi.`;
    case "08006":
    case "08003":
    case "08001":
    case "08004":
      return `Koneksi ke ${target} terputus saat permintaan diproses. Perubahan belum tersimpan; silakan coba lagi.`;
    default:
      return null;
  }
}

/** Kode error Postgres di atas yang murni sementara (aman diulang tanpa perubahan apa pun). */
export const RETRYABLE_PG_CODES = new Set(["40P01", "40001", "55P03", "57014", "08006", "08003", "08001", "08004"]);

export function isRetryableDbError(error: unknown): boolean {
  const code = errCode(error);
  return !!code && RETRYABLE_PG_CODES.has(code);
}

/**
 * Jalankan operasi database, dan ulangi SEKALI (total maksimal `attempts` percobaan) bila gagal karena
 * error yang murni sementara (lock/deadlock/koneksi terputus) — BUKAN untuk menyembunyikan bug. Error lain
 * (termasuk AppError dari validasi/permission/aturan bisnis) langsung dilempar tanpa diulang, karena tidak
 * pernah memiliki kode error Postgres yang dikenali di atas. Jeda singkat sebelum mencoba ulang agar lock
 * yang bentrok (mis. migrasi yang sedang berjalan) sempat dilepas. Aman untuk retry: operasi yang dibungkus
 * harus berupa transaksi yang sepenuhnya rollback saat gagal (sudah dijamin postgres.js pada sql().begin()).
 */
export async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 250): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableDbError(error) || i === attempts - 1) throw error;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("unreachable");
}
