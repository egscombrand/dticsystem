/**
 * Status pengerjaan resmi DTIC Connect. Nilai disimpan huruf kecil di database
 * (SUBMITTED → "submitted", dst.). Label UI berbahasa Indonesia dipakai di seluruh aplikasi.
 *
 * Aturan status awal: pengajuan baru selalu "assigned" (Siap Dikerjakan) karena pemohon wajib
 * memilih PIC. "submitted" (Pengajuan Masuk) hanya untuk data historis yang belum punya PIC.
 */
export const ORDER_STATUSES = ["submitted", "assigned", "in_progress", "pending_confirmation", "internal_revision", "awaiting_requester", "on_hold", "completed", "cancelled"] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type StatusTone = "neutral" | "accent" | "info" | "warning" | "success" | "danger" | "muted" | "violet";

export const STATUS_META: Record<OrderStatus, { label: string; tone: StatusTone; description: string }> = {
  submitted: { label: "Pengajuan Masuk", tone: "neutral", description: "Pengajuan tersimpan dan belum memiliki PIC (data lama)." },
  assigned: { label: "Siap Dikerjakan", tone: "accent", description: "PIC sudah dipilih pemohon; tugas siap dikerjakan." },
  in_progress: { label: "Sedang Dikerjakan", tone: "info", description: "Staff sedang mengerjakan request." },
  // Kode lama dipertahankan demi kompatibilitas data; maknanya: hasil menunggu pemeriksaan (QC) Manager.
  pending_confirmation: { label: "Menunggu QC Manager", tone: "violet", description: "Hasil diserahkan dan menunggu pemeriksaan QC Manager." },
  // Deskripsi tidak menyebut "Manager" secara spesifik — status ini juga dipakai saat PEMOHON yang
  // meminta revisi (lihat record_feedback di applyWorkflowAction); siapa yang meminta tercatat di
  // riwayat aktivitas (actor_name per peristiwa), bukan di teks status yang statis ini.
  internal_revision: { label: "Perlu Revisi Internal", tone: "danger", description: "Ada permintaan perbaikan sebelum hasil dapat dilanjutkan — lihat riwayat aktivitas untuk detail peminta." },
  // Deskripsi tidak mengandaikan pengiriman sudah tercatat — status ini juga tercapai langsung setelah
  // Manager menyetujui (Jalur A), sebelum ada catatan pengiriman apa pun ke pemohon.
  awaiting_requester: { label: "Menunggu Masukan Pemohon", tone: "warning", description: "Hasil siap/sudah disetujui untuk pemohon; menunggu konfirmasi pengiriman dan tanggapannya." },
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

/** SLA penugasan: order sudah punya PIC (status 'assigned') tapi belum mulai dikerjakan selama ini. */
export const ASSIGNMENT_SLA_HOURS = 24;

/**
 * true bila order sudah di status 'assigned' lebih lama dari ASSIGNMENT_SLA_HOURS tanpa berpindah ke
 * in_progress — SLA "belum ditindaklanjuti", BERBEDA dari deadline pekerjaan (isOverdue di atas).
 * `assignedAt` = waktu order terakhir MASUK status 'assigned' (lihat order_status_history); null bila
 * order tidak sedang berstatus assigned (SLA ini hanya relevan pada status itu).
 */
export function isAssignmentStale(assignedAt: Date | string | null, status: OrderStatus, now: Date = new Date()): boolean {
  if (status !== "assigned" || !assignedAt) return false;
  return now.getTime() - new Date(assignedAt).getTime() > ASSIGNMENT_SLA_HOURS * 60 * 60 * 1000;
}

/** Warna badge yang valid (dipakai juga untuk level prioritas dari database). */
export function isStatusTone(value: unknown): value is StatusTone {
  return typeof value === "string" && ["neutral", "accent", "info", "warning", "success", "danger", "muted", "violet"].includes(value);
}

/**
 * Status yang masih berjalan (belum selesai/dibatalkan) — dipakai sebagai sumber kebenaran tunggal untuk
 * tab "Pekerjaan Aktif" di daftar order (src/app/dtic/(panel)/orders/page.tsx). FINISHED_STATUSES di atas
 * adalah tab "Selesai & Dibatalkan": dibatalkan SENGAJA tidak dipisah dari selesai (keduanya status
 * terminal yang sama-sama tidak lagi memerlukan tindakan), tetapi label tab tetap menyebut keduanya
 * secara eksplisit ("Selesai & Dibatalkan") supaya tidak terlihat seperti mengklaim order dibatalkan = selesai.
 */
export const ACTIVE_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter((s) => !FINISHED_STATUSES.includes(s));

/**
 * Subset dari ACTIVE_STATUSES yang BUTUH tindakan internal (PIC/Manager) SEKARANG — dipakai tab "Perlu
 * Tindakan" di daftar order. Definisi (didokumentasikan karena status backend tidak punya flag "butuh
 * tindakan" eksplisit):
 *  - assigned: PIC sudah ditetapkan tapi belum mulai — PIC perlu memulai.
 *  - pending_confirmation: hasil sudah diserahkan, menunggu QC Manager — Manager perlu memeriksa.
 *  - internal_revision: Manager meminta revisi — PIC perlu memperbaiki.
 * SENGAJA TIDAK termasuk: in_progress (sedang berjalan normal, bukan macet), awaiting_requester (giliran
 * pemohon merespons, bukan tim internal), on_hold (ditunda dengan sengaja, bukan terabaikan).
 */
export const ACTION_NEEDED_STATUSES: readonly OrderStatus[] = ["assigned", "pending_confirmation", "internal_revision"];
