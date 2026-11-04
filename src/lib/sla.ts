/**
 * Status SLA — dimensi TERPISAH dari status pekerjaan (orders.status, lihat status.ts). Jangan dicampur:
 * status pekerjaan tidak pernah berubah karena SLA (lihat closeOrderBySla di repositories/orders.ts).
 *
 * 3 keadaan pertama murni DIHITUNG dari stage_started_at/stage_deadline_at (tidak disimpan) — hanya
 * "closed_sla" yang punya penanda permanen di database (orders.sla_closed_at, tidak pernah dihapus).
 */
export type SlaStatus = "on_track" | "at_risk" | "overdue" | "closed_sla";

export type StatusTone = "neutral" | "accent" | "info" | "warning" | "success" | "danger" | "muted" | "violet";

export const SLA_STATUS_META: Record<SlaStatus, { label: string; tone: StatusTone }> = {
  on_track: { label: "SLA Berjalan", tone: "success" },
  at_risk: { label: "Mendekati Deadline", tone: "warning" },
  overdue: { label: "Terlambat", tone: "danger" },
  closed_sla: { label: "Ditutup Otomatis (SLA)", tone: "danger" },
};

/** Bagian akhir tahapan yang dianggap "mendekati deadline" (20% waktu tersisa). */
const AT_RISK_FRACTION = 0.2;

export function slaStatusOf(
  o: { stageStartedAt: string | null; stageDeadlineAt: string | null; slaClosedAt: string | null },
  now: Date = new Date(),
): SlaStatus {
  if (o.slaClosedAt) return "closed_sla";
  if (!o.stageDeadlineAt) return "on_track"; // tidak ada aturan SLA untuk tahapan ini — tidak dianggap terlambat
  const deadline = new Date(o.stageDeadlineAt).getTime();
  const nowMs = now.getTime();
  if (deadline <= nowMs) return "overdue";
  if (o.stageStartedAt) {
    const started = new Date(o.stageStartedAt).getTime();
    const total = deadline - started;
    if (total > 0 && deadline - nowMs <= total * AT_RISK_FRACTION) return "at_risk";
  }
  return "on_track";
}
