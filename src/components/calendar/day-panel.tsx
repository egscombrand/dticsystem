import { CalendarOrderDetail } from "@/components/calendar/calendar-order-card";
import { formatDate } from "@/lib/dates";
import type { OrderListItem } from "@/lib/types";

/** Panel detail satu tanggal (muncul hanya saat tanggal dipilih). */
export function DayPanel({ dayKey, orders, todayKey, now, closeHref }: { dayKey: string; orders: OrderListItem[]; todayKey: string; now: Date; closeHref: string }) {
  return (
    <section aria-labelledby="day-panel-title" className="rounded-xl border border-line bg-surface shadow-card">
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id="day-panel-title" className="text-[15px] font-semibold text-ink">{formatDate(`${dayKey}T12:00:00+07:00`)}</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">{orders.length} order dengan deadline pada tanggal ini</p>
        </div>
        <a href={closeHref} className="shrink-0 rounded-md px-2 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft">Tutup</a>
      </header>
      {orders.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-3">Tidak ada deadline pada tanggal ini</p>
      ) : (
        <ul className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((o) => (
            <li key={o.id}>
              <CalendarOrderDetail order={o} deadlineKey={dayKey} todayKey={todayKey} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
