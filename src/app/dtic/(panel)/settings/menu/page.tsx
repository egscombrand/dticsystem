import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { MenuManager, type MenuAdminItem } from "@/components/settings/menu-manager";
import { PageHeader } from "@/components/ui/page-header";
import { BrandListSkeleton } from "@/components/ui/skeletons";
import { capableRoles } from "@/lib/menu";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/server/auth";
import { listMenuItems } from "@/lib/server/repositories/menu";

export const metadata: Metadata = { title: "Pengaturan Menu" };

export default function MenuSettingsPage() {
  return (
    <>
      <PageHeader
        title="Pengaturan Menu"
        description="Atur menu sidebar: label, urutan, visibilitas, dan role yang dapat melihat setiap menu. Hanya Super Admin."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Pengaturan Menu" }]}
      />
      <Suspense fallback={<BrandListSkeleton />}>
        <MenuContent />
      </Suspense>
    </>
  );
}

async function MenuContent() {
  await connection();
  const session = await requireSession();
  if (!can(session.role, "site.manage")) redirect("/dtic/unauthorized");
  const items = await listMenuItems();
  const data: MenuAdminItem[] = items.map((i) => ({ ...i, capableRoles: capableRoles(i) }));
  return <MenuManager items={data} />;
}
