import { describeDeadline, formatDeadline } from "@/lib/dates";
import { isFinishedStatus, isOverdue, type OrderStatus } from "@/lib/status";
import { cn } from "@/components/ui/cn";

/** Deadline + sisa waktu. Merah bila terlambat (status aktif), amber bila < 24 jam. */
export function DeadlineText({ deadlineAt, status, now, compact }: { deadlineAt: string; status: OrderStatus; now: Date; compact?: boolean }) {
  const overdue = isOverdue(deadlineAt, status, now);
  const finished = isFinishedStatus(status);
  const soon = !overdue && !finished && new Date(deadlineAt).getTime() - now.getTime() < 24 * 3600 * 1000;
  return (
    <span className="flex flex-col">
      <span className={cn("text-[13px] whitespace-nowrap", overdue ? "font-medium text-bad" : "text-ink")}>{formatDeadline(deadlineAt)}</span>
      {!compact && !finished && (
        <span className={cn("text-xs", overdue ? "text-bad" : soon ? "text-warn" : "text-ink-3")}>{describeDeadline(deadlineAt, now)}</span>
      )}
    </span>
  );
}
