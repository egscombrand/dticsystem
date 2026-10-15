/** Zona waktu operasional DTIC. Semua tampilan tanggal & pengelompokan kalender memakai zona ini. */
export const APP_TIMEZONE = "Asia/Jakarta";
export const APP_LOCALE = "id-ID";

export const ORDERS_PAGE_SIZE = 15;

export const UPLOAD_LIMITS = {
  maxFiles: 5,
  maxFileSizeBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
} as const;
