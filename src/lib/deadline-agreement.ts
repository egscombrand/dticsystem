/**
 * Kesepakatan waktu pengerjaan Pemohon ↔ PIC — dimensi TERPISAH dari status pekerjaan (orders.status) dan
 * dari status SLA (src/lib/sla.ts). Aturan murni (dipakai server & UI, diuji unit).
 *
 * Alur awal:   pic_review ──PIC terima permintaan──▶ agreed
 *              pic_review / adjustment_requested ──PIC usulkan──▶ awaiting_requester
 *              awaiting_requester ──Pemohon setujui──▶ agreed
 *              awaiting_requester ──Pemohon minta penyesuaian──▶ adjustment_requested (atau escalated bila
 *                                                                 PIC sudah mengusulkan MAX_PIC_PROPOSALS kali)
 *              (belum sepakat) ──Manager/Super Admin putuskan──▶ agreed
 * Setelah sepakat, perubahan deadline lewat usulan perubahan yang WAJIB disetujui Pemohon; deadline sepakat
 * lama tetap berlaku sampai disetujui. Diamnya Pemohon BUKAN persetujuan.
 */
export const DEADLINE_AGREEMENT_STATUSES = ["pic_review", "awaiting_requester", "adjustment_requested", "agreed", "escalated"] as const;
export type DeadlineAgreementStatus = (typeof DEADLINE_AGREEMENT_STATUSES)[number];

export type AgreementTone = "neutral" | "accent" | "info" | "warning" | "success" | "danger" | "muted" | "violet";

export const DEADLINE_AGREEMENT_META: Record<DeadlineAgreementStatus, { label: string; tone: AgreementTone; description: string }> = {
  pic_review: { label: "Pemeriksaan PIC", tone: "info", description: "PIC sedang memeriksa kebutuhan dan kelayakan waktu yang diminta Pemohon." },
  awaiting_requester: { label: "Menunggu Persetujuan Waktu", tone: "warning", description: "PIC mengusulkan waktu pengerjaan; menunggu persetujuan Pemohon." },
  adjustment_requested: { label: "Meminta Penyesuaian", tone: "warning", description: "Pemohon meminta penyesuaian waktu; menunggu usulan baru dari PIC." },
  agreed: { label: "Waktu Disepakati", tone: "success", description: "Deadline final sudah disepakati Pemohon dan PIC." },
  escalated: { label: "Eskalasi ke Manager", tone: "danger", description: "Belum tercapai kesepakatan setelah beberapa kali usulan; menunggu keputusan Manager." },
};

/** Usulan PIC tanpa kesepakatan sebelum otomatis dieskalasikan ke Manager (mencegah negosiasi tanpa akhir). */
export const MAX_PIC_PROPOSALS = 3;

export const DEADLINE_EVENT_KINDS = [
  "pic_accepted_requested",
  "pic_proposed",
  "requester_approved",
  "requester_adjustment_requested",
  "escalated",
  "manager_resolved",
  "admin_changed",
  "change_proposed",
  "change_approved",
  "change_rejected",
] as const;
export type DeadlineEventKind = (typeof DEADLINE_EVENT_KINDS)[number];

export const DEADLINE_EVENT_LABEL: Record<DeadlineEventKind, string> = {
  pic_accepted_requested: "PIC menyetujui waktu yang diminta Pemohon",
  pic_proposed: "PIC mengusulkan waktu pengerjaan",
  requester_approved: "Pemohon menyetujui waktu",
  requester_adjustment_requested: "Pemohon meminta penyesuaian waktu",
  escalated: "Dieskalasikan ke Manager",
  manager_resolved: "Manager menetapkan deadline final",
  admin_changed: "Deadline diubah secara administratif",
  change_proposed: "PIC mengusulkan perubahan deadline",
  change_approved: "Pemohon menyetujui perubahan deadline",
  change_rejected: "Pemohon menolak perubahan deadline",
};

export type DeadlineEvent = {
  kind: DeadlineEventKind;
  round: number | null;
  proposedDeadline: string | null;
  previousDeadline: string | null;
  reason: string | null;
  actorName: string | null;
  at: string;
};

/** Usulan perubahan deadline SETELAH sepakat yang belum dijawab Pemohon (event terakhir terkait perubahan). */
export function pendingChange(events: readonly DeadlineEvent[]): DeadlineEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === "change_proposed") return e;
    if (e.kind === "change_approved" || e.kind === "change_rejected" || e.kind === "admin_changed" || e.kind === "manager_resolved") return null;
  }
  return null;
}

/** PIC boleh memberi keputusan awal (terima / usulkan) hanya pada tahap ini. */
export function picCanDecide(status: DeadlineAgreementStatus): boolean {
  return status === "pic_review" || status === "adjustment_requested";
}
