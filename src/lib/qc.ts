/**
 * Penyerahan hasil, QC Manager, dan penyelesaian (MURNI: dipakai server, UI, dan unit test).
 * Server SELALU memeriksa ulang; tombol di UI hanya cerminan aturan ini.
 *
 * Tidak ada "mode kebijakan QC". PIC memilih tujuan penyerahan setiap kali:
 *   - Ke Manager            → status Menunggu QC Manager; Manager menyetujui / meminta revisi.
 *   - Langsung ke pemohon   → PIC mencatat pengiriman (setelah benar-benar mengirim). Status QC TIDAK berubah.
 * PIC dapat menyelesaikan pekerjaan dengan konfirmasi; bila belum ada pengiriman tercatat (mis. disepakati
 * di luar aplikasi) catatan penyelesaian wajib. Penyelesaian tidak membuat catatan pengiriman/persetujuan.
 * Tidak adanya respons Manager atau pemohon TIDAK pernah dianggap persetujuan.
 */
import type { Role } from "@/lib/auth/permissions";
import type { OrderStatus } from "@/lib/status";

export const QC_STATUSES = ["none", "pending", "approved", "revision"] as const;
export type QcStatus = (typeof QC_STATUSES)[number];
export const QC_STATUS_LABEL: Record<QcStatus, string> = {
  none: "Belum Diajukan",
  pending: "Menunggu Pemeriksaan Manager",
  approved: "Disetujui Manager",
  revision: "Perlu Revisi",
};

export const DELIVERY_STAGES = ["draft", "revision", "final"] as const;
export type DeliveryStage = (typeof DELIVERY_STAGES)[number];
export const DELIVERY_STAGE_LABEL: Record<DeliveryStage, string> = { draft: "Konsep awal", revision: "Revisi", final: "Final" };

export type WorkflowEventKind =
  | "qc_submitted"
  | "qc_withdrawn"
  | "qc_approved"
  | "qc_revision_requested"
  | "qc_access_requested"
  | "delivery_recorded"
  | "feedback_recorded"
  | "completed"
  | "whatsapp_opened";

export type WorkflowAction = "submit_qc" | "withdraw_qc" | "approve_qc" | "request_revision" | "request_access" | "record_delivery" | "record_feedback" | "complete";

export const ACTION_LABEL: Record<WorkflowAction, string> = {
  submit_qc: "Ajukan QC",
  withdraw_qc: "Tarik Pengajuan QC",
  approve_qc: "Setujui Hasil",
  request_revision: "Minta Revisi",
  request_access: "Minta File/Akses",
  record_delivery: "Catat Pengiriman",
  record_feedback: "Catat Masukan Pemohon",
  complete: "Selesaikan Pekerjaan",
};

export type QcContext = { status: OrderStatus; qcStatus: QcStatus };
export type QcActor = { role: Role; isAssignee: boolean };

export type ActionCheck = { ok: true } | { ok: false; status: 403 | 409 | 422; message: string; field?: "note" | "confirmSent" };

/** Panjang minimal catatan penyelesaian bila belum ada pengiriman tercatat. */
export const COMPLETION_NOTE_MIN = 5;

/**
 * Cara hasil diserahkan ke Manager saat Ajukan QC:
 *  - in_app   : file di DTIC Nexus (unggah baru atau pilih yang sudah ada) — minimal satu file.
 *  - external : sudah diserahkan di luar DTIC Nexus (WhatsApp, email, langsung, lainnya) — media & keterangan wajib.
 * Catatan penyerahan di luar aplikasi adalah klaim PIC; sistem tidak memverifikasi penerimaan.
 */
export const HANDOVER_METHODS = ["in_app", "external"] as const;
export type HandoverMethod = (typeof HANDOVER_METHODS)[number];
export const HANDOVER_CHANNELS = ["whatsapp", "email", "direct", "other"] as const;
export type HandoverChannel = (typeof HANDOVER_CHANNELS)[number];
export const HANDOVER_CHANNEL_LABEL: Record<HandoverChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  direct: "Langsung kepada Manager",
  other: "Media lain",
};
export const EXTERNAL_NOTE_MIN = 3;

/** Informasi minimum per metode penyerahan (dipakai server & UI). null = lengkap. */
export function handoverProblem(input: { method: HandoverMethod; fileCount: number; channel?: string | null; note?: string | null }): { field: "resultFileIds" | "channel" | "note"; message: string } | null {
  if (input.method === "in_app") {
    return input.fileCount > 0 ? null : { field: "resultFileIds", message: "Pilih file yang sudah ada atau unggah minimal satu file hasil." };
  }
  if (!input.channel) return { field: "channel", message: "Pilih media penyerahan hasil." };
  if ((input.note?.trim().length ?? 0) < EXTERNAL_NOTE_MIN) return { field: "note", message: "Tulis keterangan singkat penyerahan (mis. \"Dikirim ke WhatsApp Manager pukul 10.00\")." };
  return null;
}

const isQcRole = (r: Role) => r === "manager" || r === "super_admin";
/** PIC pekerjaan (Staff yang ditugaskan) atau Super Admin. */
const isPicActor = (a: QcActor) => a.role === "super_admin" || (a.role === "staff" && a.isAssignee);
/** Status ketika hasil dapat diserahkan (ke Manager atau pemohon). */
const HANDOVER: readonly OrderStatus[] = ["in_progress", "awaiting_requester"];

/** Catatan penyelesaian wajib bila hasil belum tercatat dikirim (penyelesaian disepakati di luar aplikasi). */
export function completionNeedsNote(ctx: QcContext): boolean {
  return ctx.status !== "awaiting_requester";
}

export function checkWorkflowAction(input: { action: WorkflowAction; ctx: QcContext; actor: QcActor; note?: string | null; confirmSent?: boolean }): ActionCheck {
  const { action, ctx, actor } = input;
  const note = input.note?.trim() ?? "";
  if (ctx.status === "completed" || ctx.status === "cancelled") return { ok: false, status: 409, message: "Pekerjaan sudah selesai atau dibatalkan." };

  switch (action) {
    case "submit_qc":
      if (!isPicActor(actor)) return { ok: false, status: 403, message: "Hanya PIC pekerjaan ini yang dapat mengajukan QC." };
      if (ctx.status === "pending_confirmation" || ctx.qcStatus === "pending") return { ok: false, status: 409, message: "Hasil sudah diajukan dan sedang menunggu pemeriksaan Manager." };
      if (ctx.status === "internal_revision") return { ok: false, status: 409, message: "Manager meminta revisi. Tekan Perbaiki Hasil, lalu ajukan kembali setelah diperbaiki." };
      if (!HANDOVER.includes(ctx.status)) return { ok: false, status: 409, message: "Hasil dapat diajukan setelah pekerjaan mulai dikerjakan." };
      return { ok: true };
    case "withdraw_qc":
      if (!isPicActor(actor)) return { ok: false, status: 403, message: "Hanya PIC pekerjaan ini yang dapat menarik pengajuan QC." };
      if (ctx.status !== "pending_confirmation" || ctx.qcStatus !== "pending") return { ok: false, status: 409, message: "Tidak ada pengajuan QC yang sedang menunggu." };
      return { ok: true };
    case "approve_qc":
    case "request_revision":
    case "request_access":
      if (!isQcRole(actor.role)) return { ok: false, status: 403, message: "Hanya Manager atau Super Admin yang dapat memeriksa hasil." };
      if (actor.isAssignee) return { ok: false, status: 403, message: "PIC pekerjaan ini tidak dapat memeriksa hasilnya sendiri." };
      if (ctx.status !== "pending_confirmation" || ctx.qcStatus !== "pending") return { ok: false, status: 409, message: "Tidak ada hasil yang menunggu pemeriksaan Manager." };
      if (action === "request_revision" && !note) return { ok: false, status: 422, message: "Instruksi revisi wajib diisi.", field: "note" };
      if (action === "request_access" && !note) return { ok: false, status: 422, message: "Tulis file atau akses apa yang dibutuhkan.", field: "note" };
      return { ok: true };
    case "record_delivery":
      if (!isPicActor(actor)) return { ok: false, status: 403, message: "Hanya PIC pekerjaan ini yang dapat mencatat pengiriman." };
      if (ctx.status === "pending_confirmation") return { ok: false, status: 409, message: "Hasil sedang menunggu pemeriksaan Manager. Tarik pengajuan QC bila ingin mengirim langsung ke pemohon." };
      if (ctx.status === "internal_revision") return { ok: false, status: 409, message: "Manager meminta revisi. Tekan Perbaiki Hasil lebih dulu." };
      if (!HANDOVER.includes(ctx.status)) return { ok: false, status: 409, message: "Pengiriman dicatat setelah pekerjaan mulai dikerjakan." };
      if (input.confirmSent !== true) return { ok: false, status: 422, message: "Konfirmasi bahwa hasil benar-benar sudah dikirim kepada pemohon.", field: "confirmSent" };
      return { ok: true };
    case "record_feedback":
      if (!isPicActor(actor)) return { ok: false, status: 403, message: "Hanya PIC pekerjaan ini yang dapat mencatat masukan pemohon." };
      if (ctx.status !== "awaiting_requester") return { ok: false, status: 409, message: "Masukan dicatat setelah hasil tercatat dikirim kepada pemohon." };
      if (!note) return { ok: false, status: 422, message: "Ringkasan masukan pemohon wajib diisi.", field: "note" };
      return { ok: true };
    case "complete": {
      if (!isPicActor(actor) && actor.role !== "manager") return { ok: false, status: 403, message: "Anda tidak memiliki izin menyelesaikan pekerjaan ini." };
      if (ctx.status === "pending_confirmation") {
        return { ok: false, status: 409, message: isQcRole(actor.role) && !actor.isAssignee ? "Hasil masih menunggu pemeriksaan. Setujui atau minta revisi lebih dulu." : "Hasil masih menunggu pemeriksaan Manager. Tunggu keputusan Manager atau tarik pengajuan QC." };
      }
      if (ctx.status === "internal_revision" && !(isQcRole(actor.role) && !actor.isAssignee)) {
        return { ok: false, status: 409, message: "Manager meminta revisi untuk pekerjaan ini. Perbaiki hasil lebih dulu, atau minta Manager menutup pekerjaan." };
      }
      if (!HANDOVER.includes(ctx.status) && ctx.status !== "internal_revision") return { ok: false, status: 409, message: "Pekerjaan dapat diselesaikan setelah mulai dikerjakan." };
      if (completionNeedsNote(ctx) && note.length < COMPLETION_NOTE_MIN) {
        return { ok: false, status: 422, message: `Belum ada pengiriman yang tercatat. Tulis keterangan penyelesaian (minimal ${COMPLETION_NOTE_MIN} karakter), mis. "Hasil sudah dikirim lewat WhatsApp".`, field: "note" };
      }
      return { ok: true };
    }
  }
}

/** Aksi yang relevan untuk status & role ini (tombol UI). Catatan/konfirmasi tidak diperiksa di sini. */
export function availableWorkflowActions(ctx: QcContext, actor: QcActor): WorkflowAction[] {
  const all: WorkflowAction[] = ["submit_qc", "withdraw_qc", "approve_qc", "request_revision", "request_access", "record_delivery", "record_feedback", "complete"];
  return all.filter((a) => {
    const r = checkWorkflowAction({ action: a, ctx, actor, note: "catatan uji", confirmSent: true });
    return r.ok;
  });
}

/** Status pengiriman, diturunkan dari peristiwa pengiriman yang benar-benar dicatat. */
export type DeliveryStatus = "none" | "direct" | "after_qc";
export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  none: "Belum Dikirim",
  // Satu label untuk pemohon yang sudah menerima hasil; jalurnya (langsung / setelah QC) dijelaskan terpisah.
  direct: "Sudah Dikirim ke Pemohon",
  after_qc: "Sudah Dikirim ke Pemohon",
};
