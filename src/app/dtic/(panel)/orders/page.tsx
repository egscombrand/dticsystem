import { orderScopeFor, requireSession } from "@/lib/server/auth";
import { AlertTriangle, CheckCircle2, ClipboardCheck, ClipboardList, Hourglass, ListChecks, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { OrderFilters } from "@/components/orders/order-filters";
import { OrderTable } from "@/components/orders/order-table";
import { OrderTabs, type OrderView } from "@/components/orders/order-tabs";
import { TelegramTestButton } from "@/components/orders/telegram-test-button";
import { can } from "@/lib/auth/permissions";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { OrderTableSkeleton } from "@/components/ui/skeletons";
import { StatCard } from "@/components/ui/stat-card";
import { ACTION_NEEDED_STATUSES, ACTIVE_STATUSES, FINISHED_STATUSES } from "@/lib/status";
import { listBrands } from "@/lib/server/repositories/brands";
import { listMemberOptions, listPriorities, listTeamsWithMembers } from "@/lib/server/repositories/master-data";
import { countOrdersByView, DEADLINE_FILTERS, listOrders, ORDER_SORTS, QC_QUEUE_STATUSES } from "@/lib/server/repositories/orders";
import { assigneeParam, buildQuery, enumParam, first, pageParam, priorityParam, qcStatusParam, statusListParam, textParam, uuidParam } from "@/lib/search-params";

const ORDER_VIEWS = ["active", "action", "finished", "qc"] as const;
const VIEW_STATUSES = { active: ACTIVE_STATUSES, action: ACTION_NEEDED_STATUSES, finished: FINISHED_STATUSES, qc: QC_QUEUE_STATUSES } as const;
const EMPTY_LABEL: Record<OrderView, string> = { active: "pekerjaan aktif", action: "pekerjaan yang perlu tindakan", finished: "pekerjaan selesai/dibatalkan", qc: "antrean QC" };
const EMPTY_HINT: Record<OrderView, string> = {
  active: "Pekerjaan yang diajukan melalui halaman awal akan muncul di sini.",
  action: "Pekerjaan yang butuh dimulai, diperiksa QC, atau direvisi akan muncul di sini.",
  finished: "Pekerjaan yang sudah selesai atau dibatalkan akan muncul di sini.",
  qc: "Pekerjaan yang diajukan PIC dan sedang menunggu keputusan QC akan muncul di sini.",
};

export const metadata: Metadata = { title: "Manajemen Order" };

/** Shell (header) dirender langsung; data database di-stream di dalam <Suspense> milik halaman ini
 *  agar navigasi klien (mis. ganti filter, kembali dari detail) tetap punya fallback. */
export default function OrdersPage({ searchParams }: PageProps<"/dtic/orders">) {
  return (
    <>
      <PageHeader
        title="Pengelolaan Pekerjaan"
        description="Pekerjaan yang telah diajukan melalui halaman awal: nomor, judul, kategori, seluruh PIC, status, dan deadline."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Pengelolaan Pekerjaan" }]}
      />
      <Suspense fallback={<OrderTableSkeleton />}>
        <OrdersContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function OrdersContent({ searchParams }: { searchParams: PageProps<"/dtic/orders">["searchParams"] }) {
  const sp = await searchParams;
  await connection();
  const session = await requireSession();
  const scope = orderScopeFor(session);
  const q = textParam(sp, "q");
  const brandId = uuidParam(sp, "brand");
  const requestedStatuses = statusListParam(sp);
  const priority = priorityParam(sp);
  const pic = assigneeParam(sp);
  const teamId = uuidParam(sp, "team");
  const qcStatus = qcStatusParam(sp);
  const deadline = enumParam(sp, "deadline", DEADLINE_FILTERS);
  const sort = enumParam(sp, "sort", ORDER_SORTS);
  const page = pageParam(sp);
  const now = new Date();

  // Tab "Semua Aktif" / "Perlu Tindakan" / "Selesai & Dibatalkan": status DARI BACKEND (src/lib/status.ts),
  // bukan status baru buatan tampilan. Sub-filter status pada dropdown dibatasi ke status milik tab yang
  // sedang aktif — kalau nilainya tidak cocok untuk tab ini (mis. tautan lama), diabaikan dan jatuh ke
  // seluruh tab (tidak pernah error, tidak pernah membocorkan isi tab lain).
  const view: OrderView = enumParam(sp, "view", ORDER_VIEWS) ?? "active";
  const viewStatuses = VIEW_STATUSES[view];
  const narrowedStatuses = requestedStatuses?.filter((s) => (viewStatuses as readonly string[]).includes(s));
  const statuses = narrowedStatuses?.length ? narrowedStatuses : [...viewStatuses];

  // Super Admin & Manager (orders.view_all) melihat semua PIC dan boleh memfilter berdasarkan PIC mana pun;
  // Staff sudah otomatis dibatasi pada order miliknya sendiri oleh `scope` di bawah (backend, bukan UI),
  // jadi filter PIC tidak ditampilkan untuknya sama sekali (lihat OrderFilters).
  const canFilterByPic = can(session.role, "orders.view_all");
  // Tab "Antrean QC" hanya untuk Manager/Super Admin (sama seperti filter PIC) — ini tampilan ANTREAN
  // keputusan QC, bukan sekadar "order milik saya". Tanpa sort eksplisit, urutkan sesuai antrean yang
  // diminta: terlambat → deadline terdekat → pengajuan QC terlama (lihat SORT_SQL.qc_queue).
  const effectiveSort = sort ?? (view === "qc" ? "qc_queue" : undefined);

  const countFilters = { q, brandId, priority, assignee: pic, teamId, deadline };
  const [brands, priorities, members, teams, result, counts] = await Promise.all([
    listBrands(),
    listPriorities(),
    listMemberOptions(),
    listTeamsWithMembers(),
    listOrders({ q, brandId, statuses, priority, assignee: pic, teamId, qcStatus, deadline, sort: effectiveSort, page, scope }, now),
    countOrdersByView({ ...countFilters, scope }, now),
  ]);

  const values = { q, brand: brandId, status: narrowedStatuses?.length ? first(sp, "status") : undefined, priority, deadline, pic, team: teamId, qc: qcStatus, sort };
  const hasFilter = Boolean(q || brandId || narrowedStatuses?.length || priority || deadline || pic || teamId || qcStatus);

  const superAdmin = can(session.role, "site.manage");
  // Filter sekunder (brand/kategori/prioritas/deadline/PIC/QC) ikut dibawa saat pindah tab; `status` dan
  // `page` sengaja TIDAK (opsi status berbeda per tab, nomor halaman bisa tidak valid lagi di tab lain).
  const tabQuery = { q, brand: brandId, priority, deadline, pic, team: teamId, qc: qcStatus, sort };
  const viewParam = view !== "active" ? view : undefined;

  return (
    <>
      {superAdmin && (
        <div className="mb-4 flex justify-end">
          <TelegramTestButton orders={result.items.map((o) => ({ id: o.id, orderNumber: o.orderNumber, title: o.title }))} />
        </div>
      )}

      {/* Ringkasan: data aktual (count() sungguhan), mengikuti cakupan izin pengguna yang sama dengan tabel.
          "active" menandai kartu yang cocok dengan tab/filter yang sedang dibuka — bukan hover, kondisi saat ini. */}
      <div className={`mb-5 grid grid-cols-2 gap-3 ${canFilterByPic ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        <StatCard label="Pekerjaan Aktif" value={counts.active} icon={ListChecks} tone="accent" href={`/dtic/orders${buildQuery(tabQuery)}`} active={view === "active" && deadline !== "overdue"} />
        <StatCard label="Terlambat" value={counts.overdueActive} icon={AlertTriangle} tone="danger" hint="Dari pekerjaan aktif" href={`/dtic/orders${buildQuery({ ...tabQuery, deadline: "overdue" })}`} active={deadline === "overdue"} />
        <StatCard label="Menunggu Tindakan" value={counts.actionNeeded} icon={Hourglass} tone="warning" href={`/dtic/orders${buildQuery({ ...tabQuery, view: "action" })}`} active={view === "action"} />
        {canFilterByPic && (
          <StatCard label="Perlu Evaluasi QC" value={counts.qcQueue} icon={ClipboardCheck} tone="info" hint="Menunggu keputusan Manager" href={`/dtic/orders${buildQuery({ ...tabQuery, view: "qc" })}`} active={view === "qc"} />
        )}
        <StatCard label="Pekerjaan Selesai" value={counts.finished} icon={CheckCircle2} tone="success" href={`/dtic/orders${buildQuery({ ...tabQuery, view: "finished" })}`} active={view === "finished"} />
      </div>

      <OrderTabs view={view} activeCount={counts.active} actionCount={counts.actionNeeded} finishedCount={counts.finished} qcCount={canFilterByPic ? counts.qcQueue : undefined} query={tabQuery} />
    <Card>
        <OrderFilters brands={brands} priorities={priorities} members={members} teams={teams} values={values} view={view} resultCount={result.total} canFilterByPic={canFilterByPic} />
        {result.items.length === 0 ? (
          result.total > 0 ? (
            <EmptyState
              icon={SearchX}
              title="Halaman tidak tersedia"
              description={`Hanya ada ${result.total} order untuk filter ini.`}
              action={<LinkButton href={`/dtic/orders${buildQuery({ ...values, view: viewParam })}`} variant="secondary" size="sm">Ke halaman pertama</LinkButton>}
            />
          ) : hasFilter ? (
            <EmptyState
              icon={SearchX}
              title="Tidak ada order yang cocok"
              description="Coba ubah kata kunci atau kurangi filter yang dipakai."
              action={<LinkButton href={viewParam ? `/dtic/orders?view=${viewParam}` : "/dtic/orders"} variant="secondary" size="sm">Reset filter</LinkButton>}
            />
          ) : (
            <EmptyState
              icon={ClipboardList}
              title={`Belum ada ${EMPTY_LABEL[view]}`}
              description={EMPTY_HINT[view]}
            />
          )
        ) : (
          <>
            <OrderTable orders={result.items} now={now} superAdmin={superAdmin} />
            <div className="border-t border-line">
              <Pagination
                page={result.page}
                pageSize={result.pageSize}
                total={result.total}
                hrefFor={(p) => `/dtic/orders${buildQuery({ ...values, view: viewParam, page: p > 1 ? p : undefined })}`}
              />
            </div>
          </>
        )}
    </Card>
    </>
  );
}
