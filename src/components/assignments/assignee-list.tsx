import { UserRound } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { Assignee } from "@/lib/types";

/** Tampilan PIC order. Mode compact untuk tabel/kartu Kanban. */
export function AssigneeList({ assignees, compact, names, className }: { assignees: Assignee[]; compact?: boolean; names?: boolean; className?: string }) {
  if (assignees.length === 0)
    return <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-warn", className)}>Belum ada PIC</span>;
  if (names) {
    // Seluruh nama PIC (daftar order): satu nama per baris, tanpa disingkat.
    return (
      <ul className={cn("flex flex-col gap-0.5 text-xs text-ink-2", className)} aria-label={`PIC: ${assignees.map((a) => a.name).join(", ")}`}>
        {assignees.map((a) => (
          <li key={a.id} className="flex items-center gap-1.5" title={`${a.name} — ${a.division}`}>
            <UserRound className="size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
            <span className="min-w-0 truncate">{a.name}{!a.isActive && <span className="text-ink-3"> (nonaktif)</span>}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (compact) {
    // Satu nama + "+N" agar tidak meluber ke kolom lain; daftar lengkap di tooltip & label aksesibel.
    const [first, ...rest] = assignees;
    const all = assignees.map((a) => `${a.name} — ${a.division}`).join("\n");
    return (
      <span
        className={cn("flex w-full min-w-0 max-w-full items-center gap-1.5 text-xs text-ink-2", className)}
        title={all}
        aria-label={`PIC: ${assignees.map((a) => a.name).join(", ")}`}
      >
        <UserRound className="size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
        <span className="min-w-0 truncate" aria-hidden="true">{first.name}</span>
        {rest.length > 0 && (
          <span className="shrink-0 rounded-full bg-subtle px-1.5 py-px text-[11px] font-medium text-ink-3 ring-1 ring-line" aria-hidden="true">
            +{rest.length}
          </span>
        )}
      </span>
    );
  }
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {assignees.map((a) => (
        <li key={a.id} className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent" aria-hidden="true">
            {a.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">
              {a.name}
              {!a.isActive && <span className="ml-1.5 text-xs font-normal text-ink-3">(nonaktif)</span>}
            </span>
            <span className="block truncate text-xs text-ink-3">{a.division}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
