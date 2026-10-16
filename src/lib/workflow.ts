/**
 * Aturan transisi status (MURNI, dipakai server & UI, diuji unit). Server SELALU memeriksa ulang:
 * status baru dari frontend tidak pernah dipercaya begitu saja.
 *
 * Transisi SEDERHANA (tabel di bawah, lewat POST /status):
 *   assigned ──mulai──▶ in_progress ◀──lanjutkan── on_hold ◀──tunda── in_progress
 *   internal_revision ──mulai perbaikan──▶ in_progress
 *   (status aktif) ──batalkan──▶ cancelled
 * Transisi YANG BERKAITAN DENGAN QC & PENGIRIMAN tidak ada di tabel ini; hanya lewat aksi alur QC
 * (src/lib/qc.ts, POST /workflow) yang memeriksa kebijakan QC pekerjaan:
 *   Ajukan QC → pending_confirmation (Menunggu QC Manager) → Setujui QC / Minta Revisi (internal_revision)
 *   Kirim ke Pemohon (catat pengiriman) → awaiting_requester → Catat Masukan → (revisi → in_progress) → Selesaikan
 *
 * Pelaku:
 *   - PIC (Staff yang ditugaskan): mulai, tunda, lanjutkan, serahkan hasil — hanya order miliknya.
 *   - Super Admin: semua transisi di atas + batalkan dan "submitted → assigned" (data lama setelah PIC ditetapkan).
 *   - Manager: tidak mengubah status lewat tabel ini; keputusan QC & kebijakan lewat alur QC.
 * completed & cancelled adalah status akhir; membuka kembali belum didukung.
 */
import type { Role } from "@/lib/auth/permissions";
import type { OrderStatus } from "@/lib/status";

export type NoteRule = { required: true; label: string } | { required: false; label: string };

export type Transition = {
  from: OrderStatus;
  to: OrderStatus;
  /** Teks tombol aksi. */
  action: string;
  /** "pic" = PIC order tersebut (dan Super Admin); "super_admin" = hanya Super Admin. */
  actor: "pic" | "super_admin";
  note: NoteRule;
  /** Kirim notifikasi Telegram perubahan status. */
  notify: boolean;
  /** Perlu PIC pada order (submitted → assigned). */
  requiresAssignee?: boolean;
};

const optional = (label: string): NoteRule => ({ required: false, label });
const required = (label: string): NoteRule => ({ required: true, label });

export const TRANSITIONS: readonly Transition[] = [
  { from: "assigned", to: "in_progress", action: "Mulai kerjakan", actor: "pic", note: optional("Catatan (opsional)"), notify: true },
  { from: "in_progress", to: "on_hold", action: "Tunda pekerjaan", actor: "pic", note: required("Alasan penundaan"), notify: true },
  { from: "on_hold", to: "in_progress", action: "Lanjutkan pekerjaan", actor: "pic", note: optional("Catatan (opsional)"), notify: false },
  { from: "internal_revision", to: "in_progress", action: "Perbaiki hasil", actor: "pic", note: optional("Catatan (opsional)"), notify: false },
  { from: "submitted", to: "assigned", action: "Tandai siap dikerjakan", actor: "super_admin", note: optional("Catatan (opsional)"), notify: false, requiresAssignee: true },
  ...(["submitted", "assigned", "in_progress", "internal_revision", "awaiting_requester", "on_hold", "pending_confirmation"] as const).map(
    (from): Transition => ({ from, to: "cancelled", action: "Batalkan request", actor: "super_admin", note: required("Alasan pembatalan"), notify: true }),
  ),
];

/** Status yang hanya dapat dicapai lewat aksi alur QC (menghindari pintasan lewat request status). */
const QC_ONLY_TARGETS: readonly OrderStatus[] = ["pending_confirmation", "awaiting_requester", "internal_revision"];

export type Actor = { role: Role; isAssignee: boolean };

export function findTransition(from: OrderStatus, to: OrderStatus): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function canPerform(t: Transition, actor: Actor): boolean {
  if (actor.role === "super_admin") return true;
  if (t.actor === "pic") return actor.role === "staff" && actor.isAssignee;
  return false;
}

/** Transisi yang boleh dilakukan aktor ini dari status sekarang (untuk tombol UI). */
export function allowedTransitions(from: OrderStatus, actor: Actor): Transition[] {
  return TRANSITIONS.filter((t) => t.from === from && canPerform(t, actor));
}

export type TransitionCheck =
  | { ok: true; transition: Transition }
  | { ok: false; status: 403 | 409 | 422; message: string; field?: "note" };

/** Validasi lengkap satu permintaan perubahan status. */
export function checkTransition(input: { from: OrderStatus; to: OrderStatus; actor: Actor; note: string | null; hasAssignee: boolean }): TransitionCheck {
  const t = findTransition(input.from, input.to);
  if (!t && (QC_ONLY_TARGETS.includes(input.to) || input.from === "pending_confirmation" || input.to === "completed")) {
    return { ok: false, status: 409, message: "Perubahan ini dilakukan lewat alur QC & komunikasi (Ajukan QC, Setujui QC, Kirim ke Pemohon, Selesaikan Pekerjaan), bukan lewat tombol status." };
  }
  if (!t) return { ok: false, status: 409, message: "Perubahan status ini tidak diizinkan dari status saat ini." };
  if (!canPerform(t, input.actor)) {
    return {
      ok: false,
      status: 403,
      message: input.actor.role === "manager" ? "Manager hanya memantau; perubahan status dilakukan PIC atau Super Admin." : "Anda tidak memiliki izin untuk perubahan status ini.",
    };
  }
  if (t.note.required && !input.note?.trim()) return { ok: false, status: 422, message: `${t.note.label} wajib diisi.`, field: "note" };
  if (t.requiresAssignee && !input.hasAssignee) return { ok: false, status: 422, message: "Tetapkan PIC terlebih dahulu." };
  return { ok: true, transition: t };
}
