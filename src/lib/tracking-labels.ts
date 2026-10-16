import type { OrderStatus } from "@/lib/status";

/** Label & penjelasan status untuk pemohon (halaman pelacakan publik). */
export const CLIENT_STATUS_LABEL: Record<OrderStatus, { label: string; hint: string }> = {
  submitted: { label: "Pengajuan Masuk", hint: "Pengajuan tercatat dan sedang diproses tim DTIC." },
  assigned: { label: "Siap Dikerjakan", hint: "PIC yang Anda pilih akan segera mulai mengerjakan request." },
  in_progress: { label: "Sedang Dikerjakan", hint: "PIC sedang mengerjakan request Anda." },
  // Status internal tidak membocorkan istilah QC; pemohon melihat padanan yang netral.
  pending_confirmation: { label: "Pemeriksaan Internal", hint: "Hasil sedang diperiksa tim DTIC sebelum dikirim kepada Anda." },
  internal_revision: { label: "Penyempurnaan Hasil", hint: "PIC sedang menyempurnakan hasil." },
  awaiting_requester: { label: "Menunggu Masukan Anda", hint: "Hasil sudah dikirim kepada Anda. Tim menunggu tanggapan Anda." },
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
  if (seen.has("internal_revision") || current === "internal_revision") stages.push("internal_revision");
  if (seen.has("awaiting_requester") || current === "awaiting_requester") stages.push("awaiting_requester");
  stages.push(current === "cancelled" ? "cancelled" : "completed");
  return stages;
}
