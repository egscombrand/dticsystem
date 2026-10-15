import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { IntegrationManager } from "@/components/settings/integration-manager";
import { PageHeader } from "@/components/ui/page-header";
import { BrandListSkeleton } from "@/components/ui/skeletons";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/server/auth";
import { getIntegrationStatus } from "@/lib/server/services/telegram";
import { TelegramGlobalGroup } from "@/components/settings/telegram-global-group";
import { globalGroup } from "@/lib/server/repositories/telegram-brands";
import { readBotConfig } from "@/lib/telegram";

export const metadata: Metadata = { title: "Integrasi Telegram" };

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader
        title="Integrasi Telegram"
        description="Satu grup Telegram untuk semua brand. Hanya Super Admin."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Integrasi Telegram" }]}
      />
      <Suspense fallback={<BrandListSkeleton />}>
        <IntegrationContent />
      </Suspense>
    </>
  );
}

async function IntegrationContent() {
  await connection();
  const session = await requireSession();
  if (!can(session.role, "site.manage")) redirect("/dtic/unauthorized");
  const [status, group] = await Promise.all([getIntegrationStatus(), globalGroup()]);
  return (
    <div className="flex flex-col gap-5">
      <TelegramGlobalGroup group={group} configured={readBotConfig() !== null} />
      <IntegrationManager status={status} />
    </div>
  );
}
