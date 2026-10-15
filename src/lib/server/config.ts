import "server-only";

/** Kode prioritas default untuk pengajuan yang tidak memilih prioritas (konfigurasi server). */
export const DEFAULT_PRIORITY_CODE = (process.env.DEFAULT_PRIORITY_CODE ?? "normal").trim() || "normal";
