import { Badge } from "@/components/ui/badge";
import { LOAD_LABEL, type LoadLevel } from "@/lib/workload";
import type { StatusTone } from "@/lib/status";

const TONE: Record<LoadLevel, StatusTone> = { low: "success", medium: "info", high: "danger", even: "neutral" };

/** Indikator beban KOMPARATIF terhadap anggota lain yang ditampilkan (bukan ambang kapasitas). */
export function LoadBadge({ level }: { level: LoadLevel }) {
  return (
    <Badge tone={TONE[level]} dot>
      {LOAD_LABEL[level]}
    </Badge>
  );
}
