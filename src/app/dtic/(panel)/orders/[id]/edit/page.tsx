import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/server/auth";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OrderEditForm } from "@/components/orders/order-edit-form";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { FormSkeleton } from "@/components/ui/skeletons";
import { UUID_RE } from "@/lib/server/http";
import { listBrands } from "@/lib/server/repositories/brands";
import { listOrderTypes, listPriorities, listTeamMemberOptions } from "@/lib/server/repositories/master-data";
import { getOrderDetail } from "@/lib/server/repositories/orders";

export const metadata: Metadata = { title: "Edit Pekerjaan" };

export default function EditOrderPage({ params }: PageProps<"/dtic/orders/[id]/edit">) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <EditOrderContent params={params} />
    </Suspense>
  );
}

async function EditOrderContent({ params }: { params: PageProps<"/dtic/orders/[id]/edit">["params"] }) {
  const session = await requireSession();
  // Edit detail: Super Admin & Manager. Staff diarahkan ke halaman tidak berizin.
  if (!can(session.role, "orders.update")) redirect("/dtic/unauthorized");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [order, brands, orderTypes, priorities] = await Promise.all([getOrderDetail(id), listBrands(), listOrderTypes(), listPriorities()]);
  if (!order) notFound();
  const members = await listTeamMemberOptions(order.teamId);

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Pengelolaan Pekerjaan", href: "/dtic/orders" },
          { label: order.orderNumber, href: `/dtic/orders/${order.id}` },
          { label: "Edit" },
        ]}
        title="Edit detail order"
        description="Nomor order, tanggal masuk, dan status tidak diubah di halaman ini. Gunakan panel status di halaman detail untuk mengubah status."
      />
      <Card className="max-w-4xl p-5 sm:p-7">
        <OrderEditForm order={order} brands={brands} orderTypes={orderTypes} priorities={priorities} members={members} canAssign={can(session.role, "orders.manage_pic")} />
      </Card>
    </>
  );
}
