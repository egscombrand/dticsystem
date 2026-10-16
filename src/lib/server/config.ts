import "server-only";

/** Kode prioritas default untuk pengajuan yang tidak memilih prioritas (konfigurasi server). */
export const DEFAULT_PRIORITY_CODE = (process.env.DEFAULT_PRIORITY_CODE ?? "normal").trim() || "normal";

/**
 * Batas ukuran per file hasil pekerjaan. File dikirim lewat route server satu per permintaan; di Vercel
 * body permintaan fungsi dibatasi ±4,5 MB, sehingga default di Vercel 4 MB. Atur RESULT_UPLOAD_MAX_MB
 * bila platform mengizinkan lebih besar (mis. self-host). Unggah langsung ke storage (signed URL) belum dipakai.
 */
export function resultMaxFileBytes(): number {
  const raw = Number(process.env.RESULT_UPLOAD_MAX_MB);
  const mb = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : process.env.VERCEL ? 4 : 25;
  return Math.floor(mb * 1024 * 1024);
}
