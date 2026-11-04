import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { SlaRulesManager } from "@/components/settings/sla-rules-manager";
import { Skeleton } from "@/components/ui/spinner";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/server/auth";
import { listOrderTypes } from "@/lib/server/repositories/master-data";
import { listSlaRules } from "@/lib/server/repositories/sla";

export const metadata: Metadata = { title: "SLA & Deadline Otomatis" };

export default function SlaSettingsPage() {
  return (
    <>
      <PageHeader
        title="SLA & Deadline Otomatis"
        description="Batas waktu tiap tahapan status. Tahapan yang melewati batasnya ditutup otomatis oleh sistem (lihat riwayat aktivitas pada order terkait)."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Pengaturan", href: "/dtic/settings" }, { label: "SLA & Deadline Otomatis" }]}
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <SlaSettingsContent />
      </Suspense>
    </>
  );
}

async function SlaSettingsContent() {
  await connection();
  const session = await requireSession();
  if (!can(session.role, "master.manage")) redirect("/dtic/unauthorized");
  const [rules, orderTypes] = await Promise.all([listSlaRules(), listOrderTypes({ activeOnly: true })]);
  return <SlaRulesManager initialRules={rules} orderTypes={orderTypes.map((t) => ({ id: t.id, name: t.name }))} />;
}
