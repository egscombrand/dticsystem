import type { QcStatus } from "@/lib/qc";
import { FINISHED_STATUSES, type OrderStatus, type StatusTone } from "@/lib/status";

/**
 * Status pengumpulan hasil PIC — MURNI diturunkan dari status order + status QC yang SUDAH ADA (bukan
 * status paralel baru). Lihat FASE 2B: "Gunakan status QC dan data pekerjaan yang sudah ada."
 */
export const RESULT_COLLECTION_STATUSES = ["none", "collecting", "pending_review", "needs_revision", "approved", "done"] as const;
export type ResultCollectionStatus = (typeof RESULT_COLLECTION_STATUSES)[number];

export const RESULT_COLLECTION_LABEL: Record<ResultCollectionStatus, string> = {
  none: "Belum ada hasil",
  collecting: "Sedang dikumpulkan",
  pending_review: "Menunggu pemeriksaan",
  needs_revision: "Perlu revisi",
  approved: "Disetujui",
  done: "Selesai",
};

export const RESULT_COLLECTION_TONE: Record<ResultCollectionStatus, StatusTone> = {
  none: "muted",
  collecting: "info",
  pending_review: "violet",
  needs_revision: "danger",
  approved: "success",
  done: "success",
};

export function resultCollectionStatus(input: { orderStatus: OrderStatus; qcStatus: QcStatus; resultCount: number }): ResultCollectionStatus {
  if (FINISHED_STATUSES.includes(input.orderStatus)) return "done";
  if (input.qcStatus === "approved") return "approved";
  if (input.qcStatus === "revision") return "needs_revision";
  if (input.qcStatus === "pending") return "pending_review";
  if (input.resultCount > 0) return "collecting";
  return "none";
}
