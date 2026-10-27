import { orderScopeFor, requireSession } from "@/lib/server/auth";
import { AlarmClock, CheckCircle2, ClipboardList, Clock3, Inbox, Layers, MessageSquareText, Hourglass, PauseCircle, Undo2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { BrandSummaryCard } from "@/components/dashboard/brand-summary";
import { DashboardFilterBar } from "@/components/dashboard/filter-bar";
import { DeadlineText } from "@/components/orders/deadline-text";
import { OverdueBadge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { DashboardSkeleton } from "@/components/ui/skeletons";
import { StatCard } from "@/components/ui/stat-card";
import { formatDate } from "@/lib/dates";
import { listBrands } from "@/lib/server/repositories/brands";
import { getDashboardCharts, getDashboardData } from "@/lib/server/repositories/dashboard";
import { HBars } from "@/components/charts/hbars";
import { TrendChart } from "@/components/charts/trend-chart";
import { addDaysToKey, dateKeyToUtcStart, toDateKey } from "@/lib/dates";
import { STATUS_META, ORDER_STATUSES } from "@/lib/status";
import { buildQuery, dateRangeParams, uuidParam } from "@/lib/search-params";
import { isOverdue } from "@/lib/status";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage({ searchParams }: PageProps<"/dtic/dashboard">) {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Ringkasan operasional pekerjaan yang telah diajukan melalui halaman awal."
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function DashboardContent({ searchParams }: { searchParams: PageProps<"/dtic/dashboard">["searchParams"] }) {
  const sp = await searchParams;
  await connection();
  const session = await requireSession();
  const scope = orderScopeFor(session);
  const range = dateRangeParams(sp);
  const brandId = uuidParam(sp, "brand");
  const now = new Date();

  const todayKey = toDateKey(now);
  // Grafik tren: rentang yang dipilih, atau 30 hari terakhir bila belum dipilih (dibatasi 366 hari).
  const trendToKey = range.toKey ?? todayKey;
  const trendFromKey = range.fromKey ?? addDaysToKey(trendToKey, -29);
  const spanDays = Math.min(366, Math.max(1, Math.round((dateKeyToUtcStart(trendToKey)!.getTime() - dateKeyToUtcStart(trendFromKey)!.getTime()) / 86_400_000) + 1));
  const trendFrom = dateKeyToUtcStart(addDaysToKey(trendToKey, -(spanDays - 1)))!;
  const trendTo = dateKeyToUtcStart(addDaysToKey(trendToKey, 1))!;

  const [brands, data, charts] = await Promise.all([
    listBrands(),
    getDashboardData({ from: range.from, to: range.to, brandId, scope }, now),
    getDashboardCharts({ scope, brandId, trendFrom, trendTo, rangeFrom: range.from, rangeTo: range.to }),
  ]);
  const { stats } = data;
  const listLink = (extra: Record<string, string>) => `/dtic/orders${buildQuery({ brand: brandId, ...extra })}`;

  return (
    <>

      <DashboardFilterBar brands={brands} fromKey={range.fromKey} toKey={range.toKey} brandId={brandId} todayKey={todayKey} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 sm:gap-4">
        <StatCard label="Total order" value={stats.total} icon={Layers} hint="Semua status" href={listLink({})} />
        <StatCard label="Siap Dikerjakan" value={stats.byStatus.assigned} icon={Inbox} tone="accent" hint="Belum dimulai PIC" href={listLink({ status: "assigned" })} />
        <StatCard label="Sedang Dikerjakan" value={stats.byStatus.in_progress} icon={Clock3} tone="info" hint="Termasuk revisi" href={listLink({ status: "in_progress" })} />
        <div data-tour="dash-qc-queue">
          <StatCard label="Menunggu QC Manager" value={stats.byStatus.pending_confirmation} icon={MessageSquareText} tone="accent" hint="Hasil menunggu pemeriksaan" href={listLink({ status: "pending_confirmation" })} />
        </div>
        <StatCard label="Perlu Revisi Internal" value={stats.byStatus.internal_revision} icon={Undo2} tone="danger" hint="Diminta Manager" href={listLink({ status: "internal_revision" })} />
        <StatCard label="Menunggu Masukan Pemohon" value={stats.byStatus.awaiting_requester} icon={Hourglass} tone="warning" hint="Hasil sudah dikirim" href={listLink({ status: "awaiting_requester" })} />
        <StatCard label="Ditunda" value={stats.byStatus.on_hold} icon={PauseCircle} tone="warning" hint="Ada alasan penundaan" href={listLink({ status: "on_hold" })} />
        <StatCard label="Selesai" value={stats.byStatus.completed} icon={CheckCircle2} tone="success" hint="Sudah dikonfirmasi" href={listLink({ status: "completed" })} />
        <StatCard label="Dibatalkan" value={stats.byStatus.cancelled} icon={XCircle} tone="neutral" hint="Alasan tercatat" href={listLink({ status: "cancelled" })} />
        <StatCard label="Terlambat" value={stats.overdue} icon={AlarmClock} tone="danger" hint="Lewat deadline, belum selesai" href={listLink({ deadline: "overdue" })} />
        <div data-tour="dash-action-needed">
          <StatCard label="Menunggu Tindakan" value={stats.actionNeeded} icon={Hourglass} tone="warning" hint="Belum mulai, menunggu QC, atau perlu revisi" href={`/dtic/orders?view=action`} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Tren pekerjaan" description={`Masuk dan selesai per hari (WIB), ${trendFromKey} s.d. ${trendToKey}`} />
          <div className="px-5 pb-5">
            <TrendChart label="Tren pekerjaan" data={charts.trend} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Distribusi status" description="Jumlah pekerjaan per status" />
          <div className="px-5 pb-5">
            <HBars
              items={ORDER_STATUSES.map((s) => ({ key: s, label: STATUS_META[s].label, value: stats.byStatus[s], href: listLink({ status: s }), tone: STATUS_META[s].tone === "neutral" ? "neutral" : STATUS_META[s].tone === "success" ? "success" : STATUS_META[s].tone === "danger" ? "danger" : STATUS_META[s].tone === "warning" ? "warning" : "accent" }))}
              emptyText="Belum ada pekerjaan."
            />
          </div>
        </Card>
        <Card className="xl:col-span-3" data-tour="dash-pekerjaan-per-tim">
          <CardHeader title="Pekerjaan per tim" description="Kategori pekerjaan pada rentang tanggal masuk yang dipilih" />
          <div className="px-5 pb-5">
            <HBars
              items={charts.byTeam.map((t) => ({ key: t.teamId ?? "none", label: t.name, value: t.count, href: t.teamId ? listLink({ team: t.teamId }) : undefined }))}
              emptyText="Belum ada pekerjaan pada rentang ini."
            />
          </div>
        </Card>

        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card data-tour="dash-pekerjaan-terbaru">
            <CardHeader
              title="Pekerjaan terbaru"
              description="Pengajuan yang paling baru masuk"
              action={
                <Link href="/dtic/orders" className="text-[13px] font-medium text-accent hover:text-accent-hover">
                  Lihat semua
                </Link>
              }
            />
            {data.recent.length === 0 ? (
              <EmptyState icon={ClipboardList} title="Belum ada pekerjaan" description="Pekerjaan yang diajukan melalui halaman awal akan tampil di sini." />
            ) : (
              <ul className="divide-y divide-line">
                {data.recent.map((o) => (
                  <li key={o.id}>
                    <Link href={`/dtic/orders/${o.id}`} className="flex flex-col gap-2 px-5 py-3.5 hover:bg-subtle sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{o.title}</p>
                        <p className="mt-0.5 truncate text-xs text-ink-3">
                          <span className="font-mono">{o.orderNumber}</span> · {o.brandName} · {o.requesterName} · {formatDate(o.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <PriorityBadge name={o.priorityName} tone={o.priorityTone} />
                        <StatusBadge status={o.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Deadline terdekat" description="Pekerjaan aktif diurutkan dari deadline paling dekat" />
            {data.upcoming.length === 0 ? (
              <EmptyState icon={AlarmClock} title="Tidak ada deadline aktif" description="Semua order sudah selesai atau belum ada order." />
            ) : (
              <ul className="divide-y divide-line">
                {data.upcoming.map((o) => (
                  <li key={o.id}>
                    <Link href={`/dtic/orders/${o.id}`} className="flex flex-col gap-2 px-5 py-3.5 hover:bg-subtle sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-ink">{o.title}</p>
                          {isOverdue(o.deadlineAt, o.status, now) && <OverdueBadge />}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-ink-3">
                          <span className="font-mono">{o.orderNumber}</span> · {o.brandName}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 sm:text-right">
                        <DeadlineText deadlineAt={o.deadlineAt} status={o.status} now={now} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div>
          <BrandSummaryCard brands={data.brands} />
        </div>
      </div>
    </>
  );
}
