import type { OrderStatus } from "@/lib/status";

/** Label & penjelasan status untuk pemohon (halaman pelacakan publik). */
export const CLIENT_STATUS_LABEL: Record<OrderStatus, { label: string; hint: string }> = {
  submitted: { label: "Pengajuan Masuk", hint: "Pengajuan tercatat dan sedang diproses tim DTIC." },
  assigned: { label: "Siap Dikerjakan", hint: "PIC yang Anda pilih akan segera mulai mengerjakan request." },
  in_progress: { label: "Sedang Dikerjakan", hint: "PIC sedang mengerjakan request Anda." },
  pending_confirmation: { label: "Menunggu Konfirmasi", hint: "Hasil sudah diserahkan dan menunggu konfirmasi." },
  on_hold: { label: "Ditunda", hint: "Pekerjaan ditunda sementara. Lihat pesan dari tim DTIC bila ada." },
  completed: { label: "Selesai", hint: "Hasil telah dikonfirmasi dan request ditutup." },
  cancelled: { label: "Dibatalkan", hint: "Request dibatalkan. Hubungi tim DTIC bila ada pertanyaan." },
};

/** Tahap utama timeline (tahap tambahan hanya muncul bila pernah terjadi). */
export const MAIN_STAGES: OrderStatus[] = ["assigned", "in_progress", "pending_confirmation", "completed"];

/** Urutan tahap untuk satu order berdasarkan riwayatnya (status sudah dalam bentuk baru). */
export function trackingStages(current: OrderStatus, seen: Set<OrderStatus>): OrderStatus[] {
  const stages: OrderStatus[] = [];
  if (seen.has("submitted") || current === "submitted") stages.push("submitted");
  stages.push("assigned", "in_progress");
  if (seen.has("on_hold") || current === "on_hold") stages.push("on_hold");
  stages.push("pending_confirmation");
  stages.push(current === "cancelled" ? "cancelled" : "completed");
  return stages;
}
