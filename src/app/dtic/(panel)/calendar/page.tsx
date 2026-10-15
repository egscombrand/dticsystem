import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DayPanel } from "@/components/calendar/day-panel";
import { DayAgenda, ListView, WeekView } from "@/components/calendar/agenda";
import { CalendarLegend, MonthCalendar } from "@/components/calendar/month-calendar";
import { PicFilterOptions } from "@/components/orders/order-filters";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { CalendarSkeleton } from "@/components/ui/skeletons";
import { addDaysToKey, dateKeyToUtcStart, formatLongDate, formatMonthLabel, toDateKey, weekdayMondayFirst } from "@/lib/dates";
import { anchorFromParams, calendarPeriod, sortFromParam, viewFromParam, type CalendarSort, type CalendarView } from "@/lib/calendar";
import { orderScopeFor, requireSession } from "@/lib/server/auth";
import { listBrands } from "@/lib/server/repositories/brands";
import { listMemberOptions, listOrderTypes, listPriorities, listTeamsWithMembers } from "@/lib/server/repositories/master-data";
import { listOrdersByDeadline, type CalendarFilters } from "@/lib/server/repositories/orders";
import { assigneeParam, buildQuery, first, priorityParam, statusParam, textParam, uuidParam } from "@/lib/search-params";
import { ORDER_STATUSES, STATUS_META } from "@/lib/status";
import type { OrderListItem } from "@/lib/types";

export const metadata: Metadata = { title: "Kalender Pekerjaan" };

const control =
  "h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

const VIEW_LABEL: Record<CalendarView, string> = { month: "Bulan", week: "Minggu", day: "Hari", list: "Daftar" };
const SORT_ORDER = ORDER_STATUSES as readonly string[];

export default function CalendarPage({ searchParams }: PageProps<"/dtic/calendar">) {
  return (
    <>
      <PageHeader
        title="Kalender Pekerjaan"
        description="Jadwal pekerjaan berdasarkan deadline (WIB). Pengajuan pekerjaan baru hanya melalui halaman awal."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Kalender Pekerjaan" }]}
      />
      <Suspense fallback={<CalendarSkeleton />}>
        <CalendarContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function sortOrders(orders: OrderListItem[], sort: CalendarSort): OrderListItem[] {
  const copy = [...orders];
  if (sort === "title") return copy.sort((a, b) => a.title.localeCompare(b.title, "id"));
  if (sort === "status") return copy.sort((a, b) => SORT_ORDER.indexOf(a.status) - SORT_ORDER.indexOf(b.status) || a.deadlineAt.localeCompare(b.deadlineAt));
  if (sort === "pic") {
    const first = (o: OrderListItem) => (o.assignees[0]?.name ?? "￿");
    return copy.sort((a, b) => first(a).localeCompare(first(b), "id") || a.deadlineAt.localeCompare(b.deadlineAt));
  }
  return copy; // deadline: urutan dari database (ASC)
}

async function CalendarContent({ searchParams }: { searchParams: PageProps<"/dtic/calendar">["searchParams"] }) {
  const sp = await searchParams;
  await connection();
  const session = await requireSession();
  const scope = orderScopeFor(session);
  const now = new Date();
  const todayKey = toDateKey(now);

  const view = viewFromParam(first(sp, "view"));
  const anchor = anchorFromParams(first(sp, "date"), first(sp, "month"), todayKey);
  const period = calendarPeriod(view, anchor);
  const sort = sortFromParam(first(sp, "sort"));

  const filters: CalendarFilters = {
    brandId: uuidParam(sp, "brand"),
    status: statusParam(sp),
    pic: assigneeParam(sp),
    priority: priorityParam(sp),
    teamId: uuidParam(sp, "team"),
    typeId: uuidParam(sp, "type"),
    q: textParam(sp, "q", 80),
    overdue: first(sp, "overdue") === "1",
  };
  const dayParam = first(sp, "day");
  const selectedDay = view === "month" && dayParam && dayParam >= period.fromKey && dayParam < period.toKey && dateKeyToUtcStart(dayParam) ? dayParam : undefined;

  const [brands, members, priorities, teams, types, orders] = await Promise.all([
    listBrands(),
    listMemberOptions(),
    listPriorities(),
    listTeamsWithMembers(),
    listOrderTypes(),
    listOrdersByDeadline({ from: dateKeyToUtcStart(period.fromKey)!, to: dateKeyToUtcStart(period.toKey)!, ...filters, scope }),
  ]);

  // Pekerjaan = satu baris per record (multi-PIC tidak diduplikasi). Pengelompokan per hari memakai deadline WIB.
  const byDay = new Map<string, OrderListItem[]>();
  for (const o of orders) {
    const k = toDateKey(o.deadlineAt);
    byDay.set(k, [...(byDay.get(k) ?? []), o]);
  }
  const weekDays = view === "week" ? Array.from({ length: 7 }, (_, i) => {
    const key = addDaysToKey(period.fromKey, i);
    const [y, m, d] = key.split("-").map(Number);
    return { key, label: `${["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"][weekdayMondayFirst(y, m, d)]} ${d}` };
  }) : [];

  // Filter dan navigasi selalu membawa parameter yang sama (tidak ada tombol buat pekerjaan).
  const keep: Record<string, string | undefined> = {
    brand: filters.brandId, status: filters.status, pic: filters.pic, priority: filters.priority,
    team: filters.teamId, type: filters.typeId, q: filters.q, overdue: filters.overdue ? "1" : undefined, sort: sort === "deadline" ? undefined : sort,
  };
  const href = (extra: Record<string, string | undefined>) => `/dtic/calendar${buildQuery({ ...keep, view, date: period.anchorKey, ...extra })}`;
  const navHref = (key: string) => href({ date: key });
  const activeFilters = Object.entries(keep).filter(([, v]) => v).length;
  const selectedOrders = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  const periodLabel =
    view === "day" ? formatLongDate(`${period.anchorKey}T12:00:00+07:00`)
    : view === "week" ? `${formatLongDate(`${period.fromKey}T12:00:00+07:00`)} – ${formatLongDate(`${addDaysToKey(period.toKey, -1)}T12:00:00+07:00`)}`
    : formatMonthLabel(Number(period.fromKey.slice(0, 4)), Number(period.fromKey.slice(5, 7)));
  const dayAnchorKey = view === "month" ? todayKey : period.anchorKey;

  return (
    <div className="flex flex-col gap-4">
      {/* Baris 1: tampilan, navigasi, dan hitungan */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={navHref(period.prevKey)} className="rounded-lg border border-line-strong bg-surface p-2 text-ink-2 hover:bg-subtle" aria-label={`${VIEW_LABEL[view]} sebelumnya`}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Link>
          <h2 className="min-w-44 text-center text-lg font-semibold tracking-tight text-ink capitalize" aria-live="polite">{periodLabel}</h2>
          <Link href={navHref(period.nextKey)} className="rounded-lg border border-line-strong bg-surface p-2 text-ink-2 hover:bg-subtle" aria-label={`${VIEW_LABEL[view]} berikutnya`}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
          <Link href={href({ date: todayKey })} className="ml-1 rounded-lg px-3 py-2 text-[13px] font-medium text-accent hover:bg-accent-soft">Hari Ini</Link>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label="Tampilan kalender" className="inline-flex rounded-lg bg-subtle p-0.5 ring-1 ring-line">
            {(Object.keys(VIEW_LABEL) as CalendarView[]).map((v) => (
              <Link
                key={v}
                href={href({ view: v, date: v === "day" || v === "list" || v === "week" ? period.anchorKey : dayAnchorKey, day: undefined })}
                aria-current={view === v ? "page" : undefined}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium ${view === v ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink"}`}
              >
                {v === "month" && <CalendarDays className="size-3.5" aria-hidden="true" />}
                {VIEW_LABEL[v]}
              </Link>
            ))}
          </nav>
          <p className="text-[13px] text-ink-2" data-testid="calendar-count">
            <span className="font-semibold text-ink">{orders.length}</span> pekerjaan pada periode ini
          </p>
        </div>
      </div>

      {/* Baris 2: pencarian & filter (GET, bekerja tanpa JavaScript) */}
      <form method="get" aria-label="Filter kalender" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="date" value={period.anchorKey} />
        {sort !== "deadline" && <input type="hidden" name="sort" value={sort} />}
        <label htmlFor="cal-q" className="sr-only">Cari pekerjaan</label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" aria-hidden="true" />
          <input id="cal-q" name="q" defaultValue={filters.q ?? ""} placeholder="Cari judul, nomor, atau pemohon" className={`${control} w-64 pl-8`} />
        </div>
        <label htmlFor="cal-team" className="sr-only">Tim</label>
        <select id="cal-team" name="team" defaultValue={filters.teamId ?? ""} className={control}>
          <option value="">Semua tim</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label htmlFor="cal-type" className="sr-only">Jenis pekerjaan</label>
        <select id="cal-type" name="type" defaultValue={filters.typeId ?? ""} className={control}>
          <option value="">Semua jenis</option>
          {types.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label htmlFor="cal-status" className="sr-only">Status</label>
        <select id="cal-status" name="status" defaultValue={filters.status ?? ""} className={control}>
          <option value="">Semua status</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s as keyof typeof STATUS_META].label}</option>)}
        </select>
        <label htmlFor="cal-pic" className="sr-only">PIC</label>
        <select id="cal-pic" name="pic" defaultValue={filters.pic ?? ""} className={control}>
          <PicFilterOptions members={members} />
        </select>
        <label htmlFor="cal-brand" className="sr-only">Brand pemohon</label>
        <select id="cal-brand" name="brand" defaultValue={filters.brandId ?? ""} className={control}>
          <option value="">Semua brand</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{!b.isActive ? " (nonaktif)" : ""}</option>)}
        </select>
        <label htmlFor="cal-priority" className="sr-only">Prioritas</label>
        <select id="cal-priority" name="priority" defaultValue={filters.priority ?? ""} className={control}>
          <option value="">Semua prioritas</option>
          {priorities.map((p) => <option key={p.code} value={p.code}>{p.name}{!p.isActive ? " (nonaktif)" : ""}</option>)}
        </select>
        <label className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-[13px] text-ink-2">
          <input type="checkbox" name="overdue" value="1" defaultChecked={filters.overdue} className="size-4 accent-accent" />
          Terlambat saja
        </label>
        <Button type="submit" size="sm" className="h-9">Terapkan</Button>
        {activeFilters > 0 && (
          <Link href={href({ brand: undefined, status: undefined, pic: undefined, priority: undefined, team: undefined, type: undefined, q: undefined, overdue: undefined, sort: undefined })} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-3 hover:bg-subtle hover:text-ink">
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Hapus filter ({activeFilters})
          </Link>
        )}
      </form>

      {view === "month" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CalendarLegend />
          </div>
          <MonthCalendar
            year={Number(period.fromKey.slice(0, 4))}
            month={Number(period.fromKey.slice(5, 7))}
            byDay={byDay}
            todayKey={todayKey}
            selectedDay={selectedDay}
            now={now}
            dayHref={(k) => href({ view: "month", date: period.anchorKey, day: k === selectedDay ? undefined : k })}
          />
          {selectedDay && (
            <DayPanel dayKey={selectedDay} orders={selectedOrders} todayKey={todayKey} now={now} closeHref={href({ day: undefined })} />
          )}
        </>
      )}
      {view === "week" && <WeekView days={weekDays} byDay={byDay} todayKey={todayKey} now={now} />}
      {view === "day" && <DayAgenda orders={byDay.get(period.anchorKey) ?? []} dayKey={period.anchorKey} todayKey={todayKey} now={now} />}
      {view === "list" && (
        <ListView orders={sortOrders(orders, sort)} sort={sort} sortHref={(s) => href({ sort: s === "deadline" ? undefined : s })} now={now} />
      )}
    </div>
  );
}
