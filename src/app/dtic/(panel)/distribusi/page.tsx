import { RotateCcw, Search, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DistribusiList } from "@/components/distribusi/distribusi-list";
import { LoadBadge } from "@/components/workload/load-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { OrderTableSkeleton } from "@/components/ui/skeletons";
import { can } from "@/lib/auth/permissions";
import { buildQuery, assigneeParam, first, statusListParam, textParam, uuidParam } from "@/lib/search-params";
import { requireSession } from "@/lib/server/auth";
import { listMemberOptions, listTeamMemberOptionsByTeam, listTeamsWithMembers } from "@/lib/server/repositories/master-data";
import { listOrders } from "@/lib/server/repositories/orders";
import { getAssignmentShape, getMemberWorkloads } from "@/lib/server/repositories/workload";
import { getDashboardCharts } from "@/lib/server/repositories/dashboard";
import { HBars } from "@/components/charts/hbars";
import { recommendCandidates } from "@/lib/workload";
import { dateRangeParams } from "@/lib/search-params";
import { addDaysToKey, dateKeyToUtcStart, toDateKey } from "@/lib/dates";
import { ORDER_STATUSES, STATUS_META, type OrderStatus } from "@/lib/status";
import { loadLevels } from "@/lib/workload";

export const metadata: Metadata = { title: "Distribusi Pekerjaan" };

const control =
  "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

export default async function DistribusiPage({ searchParams }: PageProps<"/dtic/distribusi">) {
  // Pemeriksaan role sebelum render apa pun: Staff dialihkan tanpa melihat isi halaman.
  const session = await requireSession();
  if (!can(session.role, "orders.manage_pic")) redirect("/dtic/unauthorized");
  return (
    <>
      <PageHeader
        title="Distribusi Pekerjaan"
        description="Atur PIC pekerjaan yang sudah ada. Setiap perubahan wajib alasan dan tercatat. Sistem tidak memindahkan pekerjaan secara otomatis."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Distribusi Pekerjaan" }]}
      />
      <Suspense fallback={<OrderTableSkeleton />}>
        <DistribusiContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function DistribusiContent({ searchParams }: { searchParams: PageProps<"/dtic/distribusi">["searchParams"] }) {
  const sp = await searchParams;
  await connection();
  const q = textParam(sp, "q");
  const pic = assigneeParam(sp);
  const teamId = uuidParam(sp, "team");
  const statusRaw = first(sp, "status");
  const statuses = statusRaw && (ORDER_STATUSES as readonly string[]).includes(statusRaw) ? ([statusRaw] as OrderStatus[]) : statusListParam(sp);
  const page = Math.max(1, Number(first(sp, "page") ?? 1) || 1);
  const now = new Date();

  const range = dateRangeParams(sp);
  const todayKey = toDateKey(now);
  const trendToKey = range.toKey ?? todayKey;
  const trendFromKey = range.fromKey ?? addDaysToKey(trendToKey, -29);
  const [teams, members, membersByTeam, workloads, result, shape, teamCounts] = await Promise.all([
    listTeamsWithMembers(),
    listMemberOptions(),
    listTeamMemberOptionsByTeam(),
    getMemberWorkloads({ teamId, statuses, from: range.from, to: range.to }),
    listOrders({ q, assignee: pic, teamId, statuses, page, from: range.from, to: range.to }, now),
    getAssignmentShape({ teamId, from: range.from, to: range.to }),
    getDashboardCharts({ brandId: undefined, trendFrom: dateKeyToUtcStart(trendFromKey)!, trendTo: dateKeyToUtcStart(addDaysToKey(trendToKey, 1))!, rangeFrom: range.from, rangeTo: range.to }),
  ]);
  // Rekomendasi per tim: hanya informasi untuk Manager; tidak mengubah PIC.
  const recommendations = teams.map((t) => {
    const teamMembers = new Set((membersByTeam[t.id] ?? []).map((m) => m.id));
    const rows = workloads.filter((w) => teamMembers.has(w.memberId));
    return { team: t, result: recommendCandidates(rows), rows };
  });
  const levels = loadLevels(workloads);
  const hasFilter = Boolean(q || pic || teamId || statuses || range.fromKey || range.toKey);
  const values = { q, pic, team: teamId, status: statusRaw, from: range.fromKey, to: range.toKey };

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 sm:p-5">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto] lg:items-end">
          <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
            Cari pekerjaan
            <input name="q" defaultValue={q ?? ""} placeholder="Judul atau nomor" className={control} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
            PIC saat ini
            <select name="pic" defaultValue={pic ?? ""} className={control}>
              <option value="">Semua PIC</option>
              <option value="none">Belum ada PIC</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{!m.isActive ? " (nonaktif)" : ""}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
            Tim
            <select name="team" defaultValue={teamId ?? ""} className={control}>
              <option value="">Semua tim</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
            Status
            <select name="status" defaultValue={statusRaw ?? ""} className={control}>
              <option value="">Semua status</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
            Masuk dari
            <input type="date" name="from" defaultValue={range.fromKey ?? ""} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
            Sampai
            <input type="date" name="to" defaultValue={range.toKey ?? ""} className={control} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" icon={<Search className="size-4" />}>Terapkan</Button>
            {hasFilter && (
              <Link href="/dtic/distribusi" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] text-ink-2 hover:bg-subtle">
                <RotateCcw className="size-4" aria-hidden="true" /> Atur ulang
              </Link>
            )}
          </div>
        </form>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Pekerjaan aktif per PIC</h2>
          <p className="mb-3 text-xs text-ink-3">Perbandingan relatif antar-PIC pada filter yang dipilih. Satu pekerjaan dihitung pada setiap PIC-nya.</p>
          <HBars
            items={workloads.slice().sort((a, b) => b.active - a.active || a.name.localeCompare(b.name)).map((w) => ({ key: w.memberId, label: w.name, value: w.active, href: `/dtic/orders${buildQuery({ pic: w.memberId })}` }))}
            emptyText="Tidak ada PIC pada filter ini."
            unit=" pekerjaan"
          />
        </Card>
        <Card className="p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Penugasan pekerjaan aktif</h2>
          <p className="mb-3 text-xs text-ink-3">Setiap pekerjaan dihitung sekali, sehingga total tidak tergandakan oleh pekerjaan multi-PIC.</p>
          <HBars
            items={[
              { key: "single", label: "Satu PIC", value: shape.single, tone: "accent" },
              { key: "multi", label: "Beberapa PIC", value: shape.multi, tone: "info" },
              { key: "none", label: "Belum ada PIC", value: shape.unassigned, tone: "warning" },
            ]}
            emptyText="Belum ada pekerjaan aktif."
            unit=" pekerjaan"
          />
          <p className="mt-3 text-xs text-ink-3">Total pekerjaan aktif: {shape.total}</p>
        </Card>
        <Card className="p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Distribusi tim dan kategori</h2>
          <p className="mb-3 text-xs text-ink-3">Semua status pada rentang tanggal masuk yang dipilih.</p>
          <HBars
            items={teamCounts.byTeam.map((t) => ({ key: t.teamId ?? "none", label: t.name, value: t.count, href: t.teamId ? `/dtic/orders${buildQuery({ team: t.teamId })}` : undefined }))}
            emptyText="Belum ada pekerjaan pada rentang ini."
          />
        </Card>
        <Card className="p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Rekomendasi PIC per tim</h2>
          <p className="mb-3 text-xs text-ink-3">Bahan pertimbangan Manager berdasarkan jumlah pekerjaan aktif dan keterlambatan. Sistem tidak memindahkan atau menambah PIC.</p>
          <ul className="flex flex-col gap-3">
            {recommendations.map(({ team, result: rec, rows }) => (
              <li key={team.id} className="rounded-lg bg-subtle px-3 py-2.5 text-[13px]">
                <p className="font-medium text-ink">{team.name}</p>
                {rec.kind === "suggest" ? (
                  <p className="text-ok">Disarankan: {rows.filter((r) => rec.memberIds.includes(r.memberId)).map((r) => r.name).join(", ")}</p>
                ) : (
                  <p className="text-ink-3">{rec.message}</p>
                )}
                {rec.kind === "suggest" && <p className="text-xs text-ink-3">{rec.reasons[rec.memberIds[0]]}</p>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        {result.items.length === 0 ? (
          <EmptyState icon={Users} title="Tidak ada pekerjaan" description={hasFilter ? "Tidak ada pekerjaan yang cocok dengan filter ini." : "Belum ada pekerjaan yang diajukan melalui halaman awal."} />
        ) : (
          <>
            <DistribusiList
              rows={result.items.map((o) => ({ id: o.id, orderNumber: o.orderNumber, title: o.title, status: o.status, deadlineAt: o.deadlineAt, teamId: o.teamId, teamName: o.teamName, assignees: o.assignees }))}
              membersByTeam={membersByTeam}
              workloads={workloads}
              now={now.toISOString()}
            />
            <div className="border-t border-line px-4 py-3 sm:px-5">
              <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(p) => `/dtic/distribusi${buildQuery({ ...values, page: p > 1 ? p : undefined })}`} />
            </div>
          </>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">Beban anggota (sebagai pembanding)</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {workloads.map((w) => (
            <li key={w.memberId} className="flex items-center justify-between gap-2 rounded-lg bg-subtle px-3 py-2 text-[13px]">
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{w.name}</span>
                <span className="text-xs text-ink-3">{w.active} aktif · {w.overdue} terlambat · {w.onHold} ditunda</span>
              </span>
              <LoadBadge level={levels[w.memberId]} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
