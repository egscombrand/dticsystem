import { cn } from "@/components/ui/cn";
import type { ActivityItem, ActivityKind } from "@/lib/collab";
import { formatDateTime } from "@/lib/dates";

const DOT: Record<ActivityKind, string> = {
  created: "bg-teal",
  assigned: "bg-brand-blue",
  status: "bg-navy",
  message: "bg-brand-violet",
  reference: "bg-brand-blue",
  brief_change: "bg-warn",
  deadline: "bg-warn",
  delivery: "bg-teal",
  decision: "bg-ok",
  review: "bg-brand-violet",
  sla: "bg-bad",
};

/** Timeline aktivitas Pemohon: hanya peristiwa yang aman dilihat Pemohon (tanpa catatan/QC internal). */
export function ActivityPanel({ items }: { items: ActivityItem[] }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="activity-title" data-testid="activity-panel">
      <h2 id="activity-title" className="text-[15px] font-semibold text-navy">Aktivitas request</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">Belum ada aktivitas.</p>
      ) : (
        <ol className="mt-4 flex flex-col">
          {[...items].reverse().map((it, i, arr) => (
            <li key={it.key} className="relative flex gap-3 pb-4 last:pb-0" data-testid="activity-item" data-kind={it.kind}>
              {i < arr.length - 1 && <span className="absolute top-3 bottom-0 left-[5px] w-px bg-line" aria-hidden="true" />}
              <span className={cn("relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-surface", DOT[it.kind])} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">{it.label}</p>
                <p className="text-[12px] text-ink-3">{[it.actor, formatDateTime(it.at)].filter(Boolean).join(" · ")}</p>
                {it.detail && <p className="mt-1 text-[12.5px] break-words whitespace-pre-wrap text-ink-2">{it.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
