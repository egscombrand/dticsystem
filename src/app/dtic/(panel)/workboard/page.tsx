import { can } from "@/lib/auth/permissions";
import { orderScopeFor, requireSession } from "@/lib/server/auth";
import { Search } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { PicFilterOptions } from "@/components/orders/order-filters";
import { KanbanBoard } from "@/components/workboard/kanban-board";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { KanbanSkeleton } from "@/components/ui/skeletons";
import { listBrands } from "@/lib/server/repositories/brands";
import { listMemberOptions } from "@/lib/server/repositories/master-data";
import { listBoardOrders } from "@/lib/server/repositories/orders";
import { assigneeParam, textParam, uuidParam } from "@/lib/search-params";

export const metadata: Metadata = { title: "Workboard" };

const control =
  "h-9 rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

export default function WorkboardPage({ searchParams }: PageProps<"/dtic/workboard">) {
  return (
    <>
      <PageHeader
        title="Workboard"
        description="Pantau dan pindahkan order antar tahap. Seret kartu ke kolom lain, atau gunakan pilihan status di setiap kartu."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Workboard" }]}
      />
      <Suspense fallback={<KanbanSkeleton />}>
        <WorkboardContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function WorkboardContent({ searchParams }: { searchParams: PageProps<"/dtic/workboard">["searchParams"] }) {
  const sp = await searchParams;
  await connection();
  const session = await requireSession();
  const scope = orderScopeFor(session);
  const brandId = uuidParam(sp, "brand");
  const q = textParam(sp, "q");
  const pic = assigneeParam(sp);
  const [brands, members, orders] = await Promise.all([listBrands(), listMemberOptions(), listBoardOrders({ brandId, q, assignee: pic, scope })]);

  return (
    <>
      <form method="get" role="search" className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative">
          <label htmlFor="wb-q" className="sr-only">Cari</label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <input id="wb-q" name="q" type="search" defaultValue={q} placeholder="Cari nomor, judul, pemohon…" className={`${control} w-64 max-w-full pl-9`} maxLength={100} />
        </div>
        <label htmlFor="wb-brand" className="sr-only">Brand pemohon</label>
        <select id="wb-brand" name="brand" defaultValue={brandId ?? ""} className={control}>
          <option value="">Semua brand pemohon</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}{!b.isActive ? " (nonaktif)" : ""}</option>
          ))}
        </select>
        <label htmlFor="wb-pic" className="sr-only">PIC</label>
        <select id="wb-pic" name="pic" defaultValue={pic ?? ""} className={`${control} max-w-56`}>
          <PicFilterOptions members={members} />
        </select>
        <Button type="submit" size="sm" variant="secondary" className="h-9">Terapkan</Button>
        {(brandId || q || pic) && (
          <Link href="/dtic/workboard" className="px-2 text-[13px] font-medium text-ink-3 hover:text-ink">Reset</Link>
        )}
        <span className="ml-auto text-[13px] text-ink-3">{orders.length} order</span>
      </form>
      <KanbanBoard initialOrders={orders} nowIso={new Date().toISOString()} canMove={can(session.role, "orders.status")} />
    </>
  );
}
