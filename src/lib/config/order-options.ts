/**
 * Preset ukuran desain untuk form pengajuan.
 * Brand, jenis order, prioritas, divisi, dan member DTIC TIDAK di sini —
 * semuanya dikelola di database melalui halaman Pengaturan.
 */
export const DESIGN_SIZE_PRESETS = [
  { value: "A3", label: "A3 (29,7 × 42 cm)" },
  { value: "A4", label: "A4 (21 × 29,7 cm)" },
  { value: "A5", label: "A5 (14,8 × 21 cm)" },
  { value: "Kartu Nama", label: "Kartu Nama (9 × 5,5 cm)" },
  { value: "Feed Instagram 1:1", label: "Feed Instagram 1:1 (1080 × 1080 px)" },
  { value: "Feed Instagram 4:5", label: "Feed Instagram 4:5 (1080 × 1350 px)" },
  { value: "Story 9:16", label: "Story / Reels 9:16 (1080 × 1920 px)" },
  { value: "Presentasi 16:9", label: "Presentasi 16:9" },
  { value: "custom", label: "Ukuran custom (cm)" },
  /** Untuk pekerjaan non-desain (IT, Dokumentasi & Event): tidak ada ukuran. */
  { value: "na", label: "Tidak ada ukuran (bukan pekerjaan desain)" },
] as const;

export const CUSTOM_SIZE_MAX_CM = 1000;
