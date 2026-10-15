import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { CAL_OVERDUE_STYLE, CAL_STATUS_STYLE } from "@/lib/calendar-colors";
import { formatDate, getZonedParts } from "@/lib/dates";
import type { CalendarSort } from "@/lib/calendar";
import { isOverdue } from "@/lib/status";
import type { OrderListItem } from "@/lib/types";

/** Jam deadline WIB; deadline tanpa jam (23.59 WIB) ditandai "Sepanjang hari", bukan jam palsu. */
export function deadlineTimeLabel(deadlineAt: string): string {
  const p = getZonedParts(new Date(deadlineAt));
  return p.hour === 23 && p.minute === 59 ? "Sepanjang hari" : `${String(p.hour).padStart(2, "0")}.${String(p.minute).padStart(2, "0")} WIB`;
}

const picText = (o: OrderListItem) => (o.assignees.length ? o.assignees.map((a) => a.name).join(", ") : "Belum ada PIC");

/** Kartu pekerjaan ringkas untuk tampilan Minggu. Satu pekerjaan = satu kartu, walau multi-PIC. */
export function WeekCard({ order, now }: { order: OrderListItem; now: Date }) {
  const late = isOverdue(order.deadlineAt, order.status, now);
  const style = late ? CAL_OVERDUE_STYLE : CAL_STATUS_STYLE[order.status].chip;
  return (
    <Link
      href={`/dtic/orders/${order.id}`}
      className={cn("block rounded-lg px-2 py-1.5 text-[12px] leading-snug ring-1 ring-inset transition-shadow hover:shadow-card focus-visible:ring-2 focus-visible:ring-accent", style)}
      aria-label={`${order.orderNumber} ${order.title}, PIC ${picText(order)}, ${CAL_STATUS_STYLE[order.status].label}${late ? ", terlambat" : ""}`}
    >
      <span className="block truncate font-semibold">{order.title}</span>
      <span className="block truncate font-mono text-[10.5px] opacity-80">{order.orderNumber}</span>
      <span className="block truncate opacity-90">PIC: {picText(order)}</span>
      <span className="mt-0.5 flex items-center gap-1 text-[10.5px] font-medium">
        <span className={cn("size-1.5 shrink-0 rounded-full", late ? "bg-[#f04438]" : CAL_STATUS_STYLE[order.status].dot)} aria-hidden="true" />
        {late ? "Terlambat" : CAL_STATUS_STYLE[order.status].label} · {deadlineTimeLabel(order.deadlineAt)}
      </span>
    </Link>
  );
}

/** Tampilan Minggu: tujuh kolom Senin–Minggu. Pekerjaan diletakkan pada tanggal deadline-nya. */
export function WeekView({ days, byDay, todayKey, now }: { days: { key: string; label: string }[]; byDay: Map<string, OrderListItem[]>; todayKey: string; now: Date }) {
  return (
    <div className="grid gap-3 md:grid-cols-7" role="list" aria-label="Pekerjaan per hari minggu ini">
      {days.map((d) => {
        const items = byDay.get(d.key) ?? [];
        const isToday = d.key === todayKey;
        return (
          <section key={d.key} role="listitem" aria-label={`${d.label}, ${items.length} pekerjaan`} className={cn("flex min-h-40 flex-col gap-2 rounded-xl border p-2.5", isToday ? "border-accent bg-accent-soft/40" : "border-line bg-surface")}>
            <header className="flex items-baseline justify-between gap-2 px-0.5">
              <h3 className={cn("text-[13px] font-semibold", isToday ? "text-accent" : "text-ink")}>{d.label}</h3>
              <span className="text-[11px] text-ink-3">{items.length}</span>
            </header>
            {items.length === 0 ? (
              <p className="px-0.5 text-[12px] text-ink-3">Tidak ada</p>
            ) : (
              items.map((o) => <WeekCard key={o.id} order={o} now={now} />)
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Tampilan Hari: agenda satu tanggal, urut jam deadline. */
export function DayAgenda({ orders, dayKey, todayKey, now }: { orders: OrderListItem[]; dayKey: string; todayKey: string; now: Date }) {
  if (orders.length === 0) return <p className="rounded-xl border border-line bg-surface px-5 py-10 text-center text-sm text-ink-3">Tidak ada pekerjaan pada {formatDate(`${dayKey}T12:00:00+07:00`)}.</p>;
  return (
    <ol className="flex flex-col gap-2" aria-label={`Agenda ${dayKey}${dayKey === todayKey ? " (hari ini)" : ""}`}>
      {orders.map((o) => {
        const late = isOverdue(o.deadlineAt, o.status, now);
        return (
          <li key={o.id}>
            <Link href={`/dtic/orders/${o.id}`} className="grid gap-2 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-accent focus-visible:ring-2 focus-visible:ring-accent sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:items-center">
              <span className="text-[13px] font-semibold text-ink-2 tabular-nums">{deadlineTimeLabel(o.deadlineAt)}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{o.title}</span>
                <span className="block truncate text-[12px] text-ink-3">
                  <span className="font-mono">{o.orderNumber}</span> · PIC: {picText(o)}
                </span>
              </span>
              <span className="flex items-center gap-2 text-[12px] font-medium">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ring-1 ring-inset", late ? CAL_OVERDUE_STYLE : CAL_STATUS_STYLE[o.status].chip)}>
                  {late ? "Terlambat" : CAL_STATUS_STYLE[o.status].label}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

const SORT_LABEL: Record<CalendarSort, string> = { deadline: "Deadline", status: "Status", pic: "PIC", title: "Judul" };

/** Tampilan Daftar: tabel yang dapat diurutkan. Pengurutan dilakukan di server lewat parameter `sort`. */
export function ListView({ orders, sort, sortHref, now }: { orders: OrderListItem[]; sort: CalendarSort; sortHref: (s: CalendarSort) => string; now: Date }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[720px] text-left text-sm">
        <caption className="sr-only">Pekerjaan periode ini, diurutkan menurut {SORT_LABEL[sort]}</caption>
        <thead className="border-b border-line bg-subtle text-xs font-medium tracking-wide text-ink-3 uppercase">
          <tr>
            {(["deadline", "title", "pic", "status"] as CalendarSort[]).map((s) => (
              <th key={s} scope="col" className="px-4 py-3 font-medium" aria-sort={sort === s ? "ascending" : undefined}>
                <a href={sortHref(s)} className={cn("hover:text-ink", sort === s && "text-accent")}>{SORT_LABEL[s]}</a>
              </th>
            ))}
            <th scope="col" className="px-4 py-3 font-medium">Nomor</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {orders.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-3">Tidak ada pekerjaan pada periode dan filter ini.</td></tr>
          )}
          {orders.map((o) => {
            const late = isOverdue(o.deadlineAt, o.status, now);
            return (
              <tr key={o.id} className="hover:bg-subtle/70">
                <td className="whitespace-nowrap px-4 py-3 text-ink-2">{formatDate(o.deadlineAt)} · {deadlineTimeLabel(o.deadlineAt)}</td>
                <td className="max-w-[320px] px-4 py-3"><Link href={`/dtic/orders/${o.id}`} className="block truncate font-medium text-ink hover:text-accent">{o.title}</Link></td>
                <td className="max-w-[260px] px-4 py-3 text-ink-2"><span className="block truncate">{picText(o)}</span></td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", late ? CAL_OVERDUE_STYLE : CAL_STATUS_STYLE[o.status].chip)}>
                    {late ? "Terlambat" : CAL_STATUS_STYLE[o.status].label}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-3">{o.orderNumber}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
