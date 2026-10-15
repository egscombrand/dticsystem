import { RotateCcw, Search, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { LoadBadge } from "@/components/workload/load-badge";
import { OverdueBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { OrderTableSkeleton } from "@/components/ui/skeletons";
import { can } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/dates";
import { HBars } from "@/components/charts/hbars";
import { assigneeParam, buildQuery, dateRangeParams, first } from "@/lib/search-params";
import { requireSession } from "@/lib/server/auth";
import { listTeamsWithMembers } from "@/lib/server/repositories/master-data";
import { getMemberWorkloads, listActiveOrdersForMembers } from "@/lib/server/repositories/workload";
import { textParam, uuidParam } from "@/lib/search-params";
import { isOverdue, ORDER_STATUSES, STATUS_META, type OrderStatus } from "@/lib/status";
import { loadLevels } from "@/lib/workload";

export const metadata: Metadata = { title: "Beban Kerja Tim" };

const control =
  "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

export default function WorkloadPage({ searchParams }: PageProps<"/dtic/workload">) {
  return (
    <>
      <PageHeader
        title="Beban Kerja Tim"
        description="Ringkasan beban kerja aktual per anggota. Perubahan PIC dilakukan di menu Distribusi Pekerjaan atau detail pekerjaan."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Beban Kerja Tim" }]}
      />
      <Suspense fallback={<OrderTableSkeleton />}>
        <WorkloadContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function WorkloadContent({ searchParams }: { searchParams: PageProps<"/dtic/workload">["searchParams"] }) {
  const sp = await searchParams;
  await connection();
  const session = await requireSession();
  // Lingkup Manager & Super Admin (melihat seluruh order). Staff diarahkan ke halaman tidak berizin.
  if (!can(session.role, "orders.view_all")) redirect("/dtic/unauthorized");
  const teamId = uuidParam(sp, "team") ?? null;
  const picId = assigneeParam(sp);
  const q = textParam(sp, "q");
  const statusRaw = first(sp, "status");
  const statuses = statusRaw && (ORDER_STATUSES as readonly string[]).includes(statusRaw) ? ([statusRaw] as OrderStatus[]) : undefined;
  const range = dateRangeParams(sp);
  const now = new Date();

  const [teams, all] = await Promise.all([
    listTeamsWithMembers(),
    getMemberWorkloads({ teamId, statuses, from: range.from, to: range.to }),
  ]);
  const byPic = picId && picId !== "none" ? all.filter((r) => r.memberId === picId) : all;
  const rows = q ? byPic.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())) : byPic;
  const orders = await listActiveOrdersForMembers(rows.map((r) => r.memberId));
  const levels = loadLevels(rows);
  const team = teams.find((t) => t.id === teamId);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 sm:p-5">
        <form method="get" className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-end">
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
            PIC
            <select name="pic" defaultValue={picId ?? ""} className={control}>
              <option value="">Semua PIC</option>
              {all.map((m) => (
                <option key={m.memberId} value={m.memberId}>{m.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
            Status
            <select name="status" defaultValue={statusRaw ?? ""} className={control}>
              <option value="">Semua status</option>
              {ORDER_STATUSES.map((st) => (
                <option key={st} value={st}>{STATUS_META[st].label}</option>
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
          <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
            Cari anggota
            <input name="q" defaultValue={q ?? ""} placeholder="Nama anggota" className={control} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" icon={<Search className="size-4" />}>Terapkan</Button>
            {(teamId || q) && (
              <Link href="/dtic/workload" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] text-ink-2 hover:bg-subtle">
                <RotateCcw className="size-4" aria-hidden="true" /> Atur ulang
              </Link>
            )}
          </div>
        </form>
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3" data-testid="workload-note">
          <strong className="font-medium text-ink-2">Cara membaca:</strong> Aktif = Pengajuan Masuk, Siap Dikerjakan, Sedang Dikerjakan,
          dan Menunggu Konfirmasi. Ditunda ditampilkan terpisah dan tidak ikut indikator beban. Terlambat = deadline lewat dan belum selesai.
          Satu order dengan beberapa PIC dihitung pada setiap PIC-nya, jadi jumlah per anggota bukan jumlah order unik tim. Indikator beban
          bersifat komparatif terhadap anggota yang ditampilkan{team ? ` (tim ${team.name})` : ""}, bukan batas kapasitas.
        </p>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">Pekerjaan aktif per PIC</h2>
        <HBars
          items={rows
            .slice()
            .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name))
            .map((r) => ({ key: r.memberId, label: r.name, value: r.active, href: `/dtic/orders${buildQuery({ pic: r.memberId, status: statuses ? statusRaw : undefined, from: range.fromKey, to: range.toKey })}` }))}
          emptyText="Tidak ada PIC yang cocok dengan filter ini."
          unit=" pekerjaan"
        />
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title="Tidak ada anggota" description="Tidak ada anggota yang cocok dengan filter ini." />
        </Card>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2" aria-label="Workload anggota">
          {rows.map((r) => {
            const mine = orders.filter((o) => o.memberId === r.memberId);
            return (
              <li key={r.memberId}>
                <Card className="flex h-full flex-col gap-3 p-4 sm:p-5" >
                  <div className="flex flex-wrap items-start justify-between gap-2" data-testid="workload-member" data-member={r.name}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {r.name}
                        {!r.isActive && <span className="ml-1.5 text-xs font-normal text-ink-3">(nonaktif)</span>}
                      </p>
                      <p className="truncate text-xs text-ink-3">{r.teams.length ? r.teams.join(", ") : "Tanpa tim"} · {r.division}</p>
                    </div>
                    <LoadBadge level={levels[r.memberId]} />
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                    {[
                      ["Aktif", r.active],
                      ["Dikerjakan", r.inProgress],
                      ["Menunggu konfirmasi", r.pendingConfirmation],
                      ["Ditunda", r.onHold],
                      ["Terlambat", r.overdue],
                    ].map(([label, value]) => (
                      <div key={label as string} className="rounded-lg bg-subtle px-2 py-2">
                        <dt className="text-[11px] leading-tight text-ink-3">{label}</dt>
                        <dd className={`text-lg font-semibold ${label === "Terlambat" && Number(value) > 0 ? "text-bad" : "text-ink"}`} data-stat={label}>{value}</dd>
                      </div>
                    ))}
                    <div className="col-span-3 rounded-lg bg-subtle px-2 py-2 sm:col-span-1">
                      <dt className="text-[11px] leading-tight text-ink-3">Deadline terdekat</dt>
                      <dd className="text-[13px] font-medium text-ink">{r.nearestDeadline ? formatDate(r.nearestDeadline) : "—"}</dd>
                    </div>
                  </dl>
                  <details className="group rounded-lg border border-line">
                    <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-ink-2">Pekerjaan berjalan ({mine.length})</summary>
                    {mine.length === 0 ? (
                      <p className="px-3 pb-3 text-[12.5px] text-ink-3">Tidak ada order berjalan.</p>
                    ) : (
                      <ul className="divide-y divide-line">
                        {mine.map((o) => (
                          <li key={o.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                            <Link href={`/dtic/orders/${o.id}`} className="min-w-0 flex-1 text-[13px] hover:text-accent">
                              <span className="block truncate font-medium text-ink">{o.title}</span>
                              <span className="font-mono text-xs text-ink-3">{o.orderNumber} · deadline {formatDate(o.deadlineAt)}</span>
                            </Link>
                            {isOverdue(o.deadlineAt, o.status, now) && <OverdueBadge />}
                            <StatusBadge status={o.status} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
