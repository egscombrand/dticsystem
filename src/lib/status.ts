/**
 * Status pengerjaan resmi DTIC Connect. Nilai disimpan huruf kecil di database
 * (SUBMITTED → "submitted", dst.). Label UI berbahasa Indonesia dipakai di seluruh aplikasi.
 *
 * Aturan status awal: pengajuan baru selalu "assigned" (Siap Dikerjakan) karena pemohon wajib
 * memilih PIC. "submitted" (Pengajuan Masuk) hanya untuk data historis yang belum punya PIC.
 */
export const ORDER_STATUSES = ["submitted", "assigned", "in_progress", "pending_confirmation", "on_hold", "completed", "cancelled"] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type StatusTone = "neutral" | "accent" | "info" | "warning" | "success" | "danger" | "muted";

export const STATUS_META: Record<OrderStatus, { label: string; tone: StatusTone; description: string }> = {
  submitted: { label: "Pengajuan Masuk", tone: "neutral", description: "Pengajuan tersimpan dan belum memiliki PIC (data lama)." },
  assigned: { label: "Siap Dikerjakan", tone: "accent", description: "PIC sudah dipilih pemohon; tugas siap dikerjakan." },
  in_progress: { label: "Sedang Dikerjakan", tone: "info", description: "Staff sedang mengerjakan request." },
  pending_confirmation: { label: "Menunggu Konfirmasi", tone: "warning", description: "Hasil sudah diserahkan dan menunggu konfirmasi." },
  on_hold: { label: "Ditunda", tone: "warning", description: "Pekerjaan dihentikan sementara (alasan tercatat)." },
  completed: { label: "Selesai", tone: "success", description: "Hasil dikonfirmasi dan request ditutup." },
  cancelled: { label: "Dibatalkan", tone: "muted", description: "Request dibatalkan (alasan tercatat)." },
};

/** Status yang tidak lagi dihitung sebagai pekerjaan aktif (tidak bisa terlambat). */
export const FINISHED_STATUSES: readonly OrderStatus[] = ["completed", "cancelled"];

/** Status sebelum alur baru. Hanya muncul di riwayat lama; tidak boleh dipakai untuk order aktif. */
export const LEGACY_STATUSES = ["new_request", "need_information", "queued", "review", "revision", "closed"] as const;
export type LegacyStatus = (typeof LEGACY_STATUSES)[number];
/** Kode status yang mungkin ada di riwayat (baru + lama). */
export type HistoryStatus = OrderStatus | LegacyStatus;

const LEGACY_LABEL: Record<LegacyStatus, string> = {
  new_request: "Request Baru (lama)",
  need_information: "Perlu Informasi (lama)",
  queued: "Antrean (lama)",
  review: "Review (lama)",
  revision: "Revisi (lama)",
  closed: "Ditutup (lama)",
};

/** Padanan status lama di alur baru (dipakai migrasi & timeline publik). */
export const LEGACY_EQUIVALENT: Record<LegacyStatus, OrderStatus> = {
  new_request: "submitted",
  need_information: "on_hold",
  queued: "assigned",
  review: "pending_confirmation",
  revision: "in_progress",
  closed: "completed",
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isLegacyStatus(value: unknown): value is LegacyStatus {
  return typeof value === "string" && (LEGACY_STATUSES as readonly string[]).includes(value);
}

/** Label untuk status apa pun di riwayat; kode tak dikenal ditampilkan apa adanya (tidak crash). */
export function statusLabel(code: string): string {
  if (isOrderStatus(code)) return STATUS_META[code].label;
  if (isLegacyStatus(code)) return LEGACY_LABEL[code];
  return code;
}

export function statusTone(code: string): StatusTone {
  return isOrderStatus(code) ? STATUS_META[code].tone : "muted";
}

/** Status baru yang setara (untuk timeline publik). */
export function toCurrentStatus(code: string): OrderStatus | null {
  if (isOrderStatus(code)) return code;
  if (isLegacyStatus(code)) return LEGACY_EQUIVALENT[code];
  return null;
}

export function isFinishedStatus(status: OrderStatus): boolean {
  return FINISHED_STATUSES.includes(status);
}

/** Order terlambat = deadline sudah lewat dan status belum Selesai/Dibatalkan. */
export function isOverdue(deadlineAt: Date | string, status: OrderStatus, now: Date = new Date()): boolean {
  if (isFinishedStatus(status)) return false;
  return new Date(deadlineAt).getTime() < now.getTime();
}

/** Warna badge yang valid (dipakai juga untuk level prioritas dari database). */
export function isStatusTone(value: unknown): value is StatusTone {
  return typeof value === "string" && ["neutral", "accent", "info", "warning", "success", "danger", "muted"].includes(value);
}

/** Status yang masih berjalan (belum selesai/dibatalkan). */
export const ACTIVE_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter((s) => !FINISHED_STATUSES.includes(s));

/** Kelompok status untuk filter daftar order. */
export const STATUS_GROUPS = [
  { value: ACTIVE_STATUSES.join(","), label: "Semua yang masih berjalan" },
  { value: "completed,cancelled", label: "Selesai atau dibatalkan" },
] as const;
