import { ArrowRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dates";
import type { StatusHistoryEntry } from "@/lib/types";

export function StatusTimeline({ history }: { history: StatusHistoryEntry[] }) {
  if (history.length === 0) return <p className="text-sm text-ink-3">Belum ada riwayat.</p>;
  return (
    <ol className="relative flex flex-col gap-5 border-l border-line pl-5">
      {history.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-line-strong ring-1 ring-line" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-1.5">
            {h.previousStatus ? (
              <>
                <StatusBadge status={h.previousStatus} />
                <ArrowRight className="size-3.5 text-ink-3" aria-label="menjadi" />
              </>
            ) : null}
            <StatusBadge status={h.newStatus} />
          </div>
          <p className="mt-1 text-xs text-ink-3">
            {formatDateTime(h.changedAt)} · oleh <span className="font-medium text-ink-2">{h.actor}</span>
          </p>
          {h.notes && <p className="mt-1 text-[13px] whitespace-pre-wrap text-ink-2">{h.notes}</p>}
        </li>
      ))}
    </ol>
  );
}
