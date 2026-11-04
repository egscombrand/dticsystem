import { AlarmClock, CheckCircle2, Clock3, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { slaStatusOf, SLA_STATUS_META, type SlaStatus } from "@/lib/sla";

const ICON: Record<SlaStatus, typeof Clock3> = {
  on_track: CheckCircle2,
  at_risk: Timer,
  overdue: AlarmClock,
  closed_sla: AlarmClock,
};

/**
 * Indikator status SLA — TERPISAH dari StatusBadge (status pekerjaan). Ikon + label berbeda per keadaan,
 * bukan hanya warna (lihat src/lib/sla.ts).
 */
export function SlaBadge({ stageStartedAt, stageDeadlineAt, slaClosedAt }: { stageStartedAt: string | null; stageDeadlineAt: string | null; slaClosedAt: string | null }) {
  if (!stageDeadlineAt && !slaClosedAt) return null; // tidak ada SLA dikonfigurasi untuk tahapan ini — tidak menampilkan apa pun
  const status = slaStatusOf({ stageStartedAt, stageDeadlineAt, slaClosedAt });
  const Icon = ICON[status];
  return (
    <span data-testid="sla-badge">
      <Badge tone={SLA_STATUS_META[status].tone}>
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        {SLA_STATUS_META[status].label}
      </Badge>
    </span>
  );
}
