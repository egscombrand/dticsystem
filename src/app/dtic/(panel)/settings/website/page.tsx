import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteManager } from "@/components/settings/site-manager";
import { PageHeader } from "@/components/ui/page-header";
import { BrandListSkeleton } from "@/components/ui/skeletons";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/server/auth";
import { getSiteSettings } from "@/lib/server/repositories/site";

export const metadata: Metadata = { title: "Pengaturan Website" };

export default function WebsiteSettingsPage() {
  return (
    <>
      <PageHeader
        title="Pengaturan Website"
        description="Nama sistem, tagline, dan default sidebar. Hanya Super Admin."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Pengaturan Website" }]}
      />
      <Suspense fallback={<BrandListSkeleton />}>
        <SiteContent />
      </Suspense>
    </>
  );
}

async function SiteContent() {
  await connection();
  const session = await requireSession();
  if (!can(session.role, "site.manage")) redirect("/dtic/unauthorized");
  const site = await getSiteSettings();
  return <SiteManager initial={site} />;
}
