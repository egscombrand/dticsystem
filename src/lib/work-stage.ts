import { FINISHED_STATUSES, type OrderStatus } from "@/lib/status";
import type { QcStatus } from "@/lib/qc";

/**
 * Stepper visual 8 tahap — MURNI tampilan, diturunkan dari order.status + qcStatus + riwayat peristiwa
 * yang SUDAH ADA (tidak ada status database baru, tidak ada transisi baru). "on_hold" tidak termasuk
 * tahap linear ini (ditampilkan terpisah via StatusBadge yang sudah ada) karena bisa terjadi di tahap mana pun.
 */
export const WORK_STAGES = ["waiting_start", "in_progress", "draft_result", "pending_review", "needs_revision", "pending_rereview", "approved", "done"] as const;
export type WorkStage = (typeof WORK_STAGES)[number];

export const WORK_STAGE_LABEL: Record<WorkStage, string> = {
  waiting_start: "Menunggu Dikerjakan",
  in_progress: "Sedang Dikerjakan",
  draft_result: "Draf Hasil",
  pending_review: "Menunggu Pemeriksaan",
  needs_revision: "Perlu Revisi",
  pending_rereview: "Menunggu Pemeriksaan Ulang",
  approved: "Disetujui",
  done: "Selesai",
};

export function deriveWorkStage(input: { orderStatus: OrderStatus; qcStatus: QcStatus; hasDraftResults: boolean; hasEverRequestedRevision: boolean }): WorkStage {
  if (FINISHED_STATUSES.includes(input.orderStatus)) return "done";
  if (input.orderStatus === "internal_revision") return "needs_revision";
  if (input.qcStatus === "approved") return "approved";
  if (input.qcStatus === "pending") return input.hasEverRequestedRevision ? "pending_rereview" : "pending_review";
  // Jalur A (langsung ke pemohon, TANPA Manager — qcStatus tetap 'none' sepanjang jalur ini): status
  // 'awaiting_requester' berarti menunggu keputusan pemohon, SAMA PERSIS maknanya dengan "menunggu
  // pemeriksaan" di Jalur B (Manager) — sebelumnya TIDAK TERTANGANI sama sekali di sini, sehingga
  // pekerjaan Jalur A yang sudah diajukan ke pemohon keliru tampil seolah "Menunggu Dikerjakan".
  if (input.orderStatus === "awaiting_requester") return input.hasEverRequestedRevision ? "pending_rereview" : "pending_review";
  if (input.orderStatus === "in_progress") return input.hasDraftResults ? "draft_result" : "in_progress";
  return "waiting_start";
}
