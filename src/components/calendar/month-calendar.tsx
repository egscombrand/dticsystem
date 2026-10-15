import Link from "next/link";
import { CalendarEventChip } from "@/components/calendar/calendar-order-card";
import { cn } from "@/components/ui/cn";
import { CAL_OVERDUE_STYLE, CAL_STATUS_STYLE } from "@/lib/calendar-colors";
import { daysInMonth, shiftMonth, weekdayMondayFirst } from "@/lib/dates";
import { isOverdue } from "@/lib/status";
import type { OrderListItem } from "@/lib/types";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const MAX_CHIPS = 3;
const pad = (n: number) => String(n).padStart(2, "0");

/** Legenda warna status + keterlambatan (kecil, di atas kalender). */
export function CalendarLegend() {
  const items = Object.entries(CAL_STATUS_STYLE).filter(([k]) => k !== "submitted");
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ink-2" aria-label="Keterangan warna">
      {items.map(([k, v]) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", v.dot)} aria-hidden="true" />
          {v.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-[#f04438]" aria-hidden="true" />
        Terlambat (belum selesai)
      </li>
    </ul>
  );
}

/** Kalender bulanan lebar penuh. Sel kosong tidak berisi tanda apa pun. */
export function MonthCalendar({
  year,
  month,
  byDay,
  todayKey,
  selectedDay,
  dayHref,
  now,
}: {
  year: number;
  month: number;
  byDay: Map<string, OrderListItem[]>;
  todayKey: string;
  selectedDay?: string;
  dayHref: (key: string) => string;
  now: Date;
}) {
  const total = daysInMonth(year, month);
  const lead = weekdayMondayFirst(year, month, 1);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const prevTotal = daysInMonth(prev.year, prev.month);

  type Cell = { day: number; key?: string; inMonth: boolean };
  const cells: Cell[] = [];
  for (let i = lead; i > 0; i--) cells.push({ day: prevTotal - i + 1, inMonth: false });
  for (let d = 1; d <= total; d++) cells.push({ day: d, key: `${year}-${pad(month)}-${pad(d)}`, inMonth: true });
  let trailing = 1;
  while (cells.length % 7 !== 0) cells.push({ day: trailing++, inMonth: false });
  void next;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div role="row" className="grid grid-cols-7 border-b border-line bg-subtle">
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader" className="px-2 py-3 text-center text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          const edgeRight = (i + 1) % 7 === 0;
          const base = cn("flex min-h-20 min-w-0 flex-col gap-1 border-b border-line p-1.5 sm:min-h-32 sm:p-2 xl:min-h-40", !edgeRight && "border-r");
          if (!cell.inMonth || !cell.key) {
            return (
              <div key={`o${i}`} className={cn(base, "bg-[#fafbfc]")}>
                <span className="px-1 text-xs font-medium text-ink-3/50 tabular-nums" aria-hidden="true">{cell.day}</span>
              </div>
            );
          }
          const key = cell.key;
          const items = byDay.get(key) ?? [];
          const overdueCount = items.filter((o) => isOverdue(o.deadlineAt, o.status, now)).length;
          const isToday = key === todayKey;
          const isPast = key < todayKey;
          const selected = key === selectedDay;
          return (
            <div key={key} className={cn(base, isPast && "bg-[#fcfcfd]", selected && "bg-accent-soft/40")}>
              <Link
                href={dayHref(key)}
                aria-label={`${cell.day}: ${items.length} order${overdueCount ? `, ${overdueCount} terlambat` : ""}`}
                aria-current={selected ? "date" : undefined}
                className="flex items-center justify-between gap-1 rounded-md px-0.5 hover:bg-subtle focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
              >
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums",
                    isToday ? "bg-accent text-white shadow-card" : isPast ? "text-ink-3" : "text-ink",
                  )}
                >
                  {cell.day}
                </span>
                {items.length > 0 && (
                  <span className={cn("rounded-full px-1.5 text-[11px] leading-5 font-semibold tabular-nums sm:hidden", overdueCount > 0 ? CAL_OVERDUE_STYLE : "bg-accent-soft text-accent")}>
                    {items.length}
                  </span>
                )}
              </Link>

              {/* Desktop/tablet: chip event. Mobile: hanya titik ringkas (detail di panel tanggal). */}
              <div className="hidden min-w-0 flex-col gap-1 sm:flex">
                {items.slice(0, MAX_CHIPS).map((o) => (
                  <CalendarEventChip key={o.id} order={o} deadlineKey={key} todayKey={todayKey} now={now} />
                ))}
                {items.length > MAX_CHIPS && (
                  <Link href={dayHref(key)} className="px-1.5 text-left text-[12px] font-medium text-accent hover:underline">
                    +{items.length - MAX_CHIPS} lainnya
                  </Link>
                )}
              </div>
              <div className="flex flex-wrap gap-1 sm:hidden" aria-hidden="true">
                {items.slice(0, 4).map((o) => (
                  <span key={o.id} className={cn("size-1.5 rounded-full", isOverdue(o.deadlineAt, o.status, now) ? "bg-[#f04438]" : CAL_STATUS_STYLE[o.status].dot)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
