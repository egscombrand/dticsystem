/**
 * Tahapan pesan saat halaman memuat lama. Murni (tanpa efek samping) supaya mudah diuji.
 * normal    : baru mulai — cukup indikator animasi.
 * slow      : > SLOW_AFTER_MS — jelaskan bahwa data sedang diambil dan biasanya hanya beberapa detik.
 * very_slow : > VERY_SLOW_AFTER_MS — akui lebih lambat dari biasanya, tenangkan (data aman), tawarkan muat ulang.
 */
export type LoadingStage = "normal" | "slow" | "very_slow";

export const SLOW_AFTER_MS = 3_000;
export const VERY_SLOW_AFTER_MS = 8_000;

export function loadingStage(elapsedMs: number): LoadingStage {
  if (elapsedMs >= VERY_SLOW_AFTER_MS) return "very_slow";
  if (elapsedMs >= SLOW_AFTER_MS) return "slow";
  return "normal";
}

export const LOADING_COPY: Record<LoadingStage, string> = {
  normal: "Mengambil data terbaru dari server…",
  slow: "Masih memuat. Biasanya hanya beberapa detik — terima kasih sudah menunggu.",
  very_slow:
    "Memuat lebih lama dari biasanya, kemungkinan koneksi atau server sedang sibuk. Data Anda aman. Mohon tunggu sebentar, atau muat ulang halaman bila tak kunjung tampil.",
};

