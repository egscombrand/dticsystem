/**
 * Konfigurasi pool database (murni, tanpa efek samping; diuji unit).
 */
/**
 * Ukuran pool per instance proses. Default 1: setiap instance serverless (Vercel) membawa pool sendiri, dan
 * Supabase session pooler membatasi total klien (pool_size, mis. 15). Pool 5 per instance cepat melampaui batas
 * itu saat instance bertambah (EMAXCONNSESSION). Query dalam satu instance tetap berjalan berurutan lewat pool.
 * Nilai dibatasi 1–10 agar konfigurasi salah tidak membuka koneksi tak terkendali.
 */
export function poolMax(raw: string | undefined): number {
  const n = Math.trunc(Number(raw ?? 1));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10) : 1;
}
