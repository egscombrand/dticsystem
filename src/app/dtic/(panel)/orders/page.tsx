import { orderScopeFor, requireSession } from "@/lib/server/auth";
import { ClipboardList, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { OrderFilters } from "@/components/orders/order-filters";
import { OrderTable } from "@/components/orders/order-table";
import { TelegramTestButton } from "@/components/orders/telegram-test-button";
import { can } from "@/lib/auth/permissions";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { OrderTableSkeleton } from "@/components/ui/skeletons";
import { listBrands } from "@/lib/server/repositories/brands";
import { listMemberOptions, listPriorities } from "@/lib/server/repositories/master-data";
import { DEADLINE_FILTERS, listOrders, ORDER_SORTS } from "@/lib/server/repositories/orders";
import { assigneeParam, buildQuery, enumParam, first, pageParam, priorityParam, statusListParam, textParam, uuidParam } from "@/lib/search-params";

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
  const statuses = statusListParam(sp);
  const priority = priorityParam(sp);
  const pic = assigneeParam(sp);
  const teamId = uuidParam(sp, "team");
  const deadline = enumParam(sp, "deadline", DEADLINE_FILTERS);
  const sort = enumParam(sp, "sort", ORDER_SORTS);
  const page = pageParam(sp);
  const now = new Date();

  const [brands, priorities, members, result] = await Promise.all([
    listBrands(),
    listPriorities(),
    listMemberOptions(),
    listOrders({ q, brandId, statuses, priority, assignee: pic, teamId, deadline, sort, page, scope }, now),
  ]);

  const values = { q, brand: brandId, status: statuses ? first(sp, "status") : undefined, priority, deadline, pic, team: teamId, sort };
  const hasFilter = Boolean(q || brandId || statuses || priority || deadline || pic || teamId);

  const superAdmin = can(session.role, "site.manage");

  return (
    <>
      {superAdmin && (
        <div className="mb-4 flex justify-end">
          <TelegramTestButton orders={result.items.map((o) => ({ id: o.id, orderNumber: o.orderNumber, title: o.title }))} />
        </div>
      )}
    <Card>
        <OrderFilters brands={brands} priorities={priorities} members={members} values={values} />
        {result.items.length === 0 ? (
          result.total > 0 ? (
            <EmptyState
              icon={SearchX}
              title="Halaman tidak tersedia"
              description={`Hanya ada ${result.total} order untuk filter ini.`}
              action={<LinkButton href={`/dtic/orders${buildQuery({ ...values })}`} variant="secondary" size="sm">Ke halaman pertama</LinkButton>}
            />
          ) : hasFilter ? (
            <EmptyState
              icon={SearchX}
              title="Tidak ada order yang cocok"
              description="Coba ubah kata kunci atau kurangi filter yang dipakai."
              action={<LinkButton href="/dtic/orders" variant="secondary" size="sm">Reset filter</LinkButton>}
            />
          ) : (
            <EmptyState
              icon={ClipboardList}
              title="Belum ada pekerjaan"
              description="Pekerjaan yang diajukan melalui halaman awal akan muncul di sini."
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
                hrefFor={(p) => `/dtic/orders${buildQuery({ ...values, page: p > 1 ? p : undefined })}`}
              />
            </div>
          </>
        )}
    </Card>
    </>
  );
}
