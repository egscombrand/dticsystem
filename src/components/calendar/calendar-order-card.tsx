import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { CAL_OVERDUE_STYLE, CAL_STATUS_STYLE } from "@/lib/calendar-colors";
import { daysBetweenKeys } from "@/lib/dates";
import { isFinishedStatus, isOverdue } from "@/lib/status";
import type { OrderListItem } from "@/lib/types";

/** Label keterlambatan dari selisih hari kalender WIB. */
export function overdueLabel(deadlineKey: string, todayKey: string): string {
  const days = daysBetweenKeys(deadlineKey, todayKey);
  return days <= 0 ? "Lewat tenggat hari ini" : `Terlambat ${days} hari`;
}

/** Prioritas tinggi = tone danger/warning dari master prioritas (bukan teks hardcoded). */
const isHighPriority = (o: OrderListItem) => o.priorityTone === "danger" || o.priorityTone === "warning";

/** Event di dalam sel tanggal: satu baris chip ringkas (judul utama, status lewat warna). */
export function CalendarEventChip({ order, deadlineKey, todayKey, now }: { order: OrderListItem; deadlineKey: string; todayKey: string; now: Date }) {
  const late = isOverdue(order.deadlineAt, order.status, now);
  const finished = isFinishedStatus(order.status);
  const style = late ? CAL_OVERDUE_STYLE : CAL_STATUS_STYLE[order.status].chip;
  return (
    <Link
      href={`/dtic/orders/${order.id}`}
      title={`${order.orderNumber} · ${order.title} · ${CAL_STATUS_STYLE[order.status].label}${late ? ` · ${overdueLabel(deadlineKey, todayKey)}` : ""}`}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] leading-5 ring-1 ring-inset transition-shadow hover:shadow-card focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none",
        style,
        finished && !late && "line-through decoration-1",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", late ? "bg-[#f04438]" : CAL_STATUS_STYLE[order.status].dot)} aria-hidden="true" />
      <span className="truncate font-medium">{order.title}</span>
      {isHighPriority(order) && <span className="shrink-0 text-[10px] font-bold" aria-label="Prioritas tinggi">!</span>}
      {late && <span className="sr-only">, terlambat</span>}
    </Link>
  );
}

/** Detail satu order di panel tanggal. Informasi lengkap ada di sini, bukan di sel kalender. */
export function CalendarOrderDetail({ order, deadlineKey, todayKey, now }: { order: OrderListItem; deadlineKey: string; todayKey: string; now: Date }) {
  const late = isOverdue(order.deadlineAt, order.status, now);
  const picNames = order.assignees.map((a) => a.name);
  return (
    <Link href={`/dtic/orders/${order.id}`} className="block rounded-lg border border-line bg-surface p-3 transition-colors hover:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none">
      <div className="flex items-start gap-2">
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", late ? "bg-[#f04438]" : CAL_STATUS_STYLE[order.status].dot)} aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{order.title}</p>
          <p className="font-mono text-[11px] text-ink-3">{order.orderNumber} · {order.brandName}</p>
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[12px]">
        <dt className="text-ink-3">Status</dt>
        <dd className="text-ink-2">{CAL_STATUS_STYLE[order.status].label}</dd>
        <dt className="text-ink-3">PIC</dt>
        <dd className="truncate text-ink-2">{picNames.length ? picNames.join(", ") : "Belum ada PIC"}</dd>
        <dt className="text-ink-3">Prioritas</dt>
        <dd className="text-ink-2">{order.priorityName}</dd>
        <dt className="text-ink-3">Pemohon</dt>
        <dd className="truncate text-ink-2">{order.requesterName}</dd>
      </dl>
      {late && <p className="mt-2 text-[12px] font-semibold text-[#b42318]">{overdueLabel(deadlineKey, todayKey)}</p>}
    </Link>
  );
}
