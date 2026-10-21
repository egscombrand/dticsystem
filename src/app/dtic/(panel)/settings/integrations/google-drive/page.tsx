import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { GoogleDriveSettings } from "@/components/settings/google-drive-settings";
import { PageHeader } from "@/components/ui/page-header";
import { BrandListSkeleton } from "@/components/ui/skeletons";
import { driveAdminStatus } from "@/lib/drive";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/server/auth";
import { resolveDriveConfig } from "@/lib/server/drive";
import { countFailedDriveSyncs, getDriveIntegrationState, listFailedDriveSyncs } from "@/lib/server/repositories/drive-settings";
import { getOAuthConnection } from "@/lib/server/repositories/drive-oauth";
import { isOAuthConfigured } from "@/lib/server/drive/oauth-client";

export const metadata: Metadata = { title: "Integrasi Google Drive" };

export default function GoogleDrivePage() {
  return (
    <>
      <PageHeader
        title="Integrasi Google Drive"
        description="Drive A sebagai pusat pengumpulan hasil pekerjaan PIC. Hanya Super Admin."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Pengaturan", href: "/dtic/settings" }, { label: "Integrasi Google Drive" }]}
      />
      <Suspense fallback={<BrandListSkeleton />}>
        <GoogleDriveContent />
      </Suspense>
    </>
  );
}

async function GoogleDriveContent() {
  await connection();
  const session = await requireSession();
  if (!can(session.role, "site.manage")) redirect("/dtic/unauthorized");

  const cfg = resolveDriveConfig(process.env);
  const [state, failedCount, failedSyncs, oauth] = await Promise.all([getDriveIntegrationState(), countFailedDriveSyncs(), listFailedDriveSyncs(20), getOAuthConnection()]);

  const status = driveAdminStatus({ configOk: cfg.ok, configProblem: cfg.ok ? null : cfg.problem, enabled: state.enabled, lastTestOk: state.lastTestOk });

  // Metode autentikasi: nama variabel yang terisi saja, tidak pernah nilainya.
  const authMethod = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
    ? "GOOGLE_SERVICE_ACCOUNT_JSON"
    : process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim()
      ? "GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
      : null;

  return (
    <GoogleDriveSettings
      status={status}
      configOk={cfg.ok}
      configProblem={cfg.ok ? null : cfg.problem}
      rootFolderId={cfg.ok ? cfg.rootFolderId : null}
      usesSharedDrive={cfg.ok ? cfg.sharedDriveId !== null : false}
      authMethod={authMethod}
      enabled={state.enabled}
      enabledAt={state.enabledAt}
      lastTestAt={state.lastTestAt}
      lastTestOk={state.lastTestOk}
      lastTestMessage={state.lastTestMessage}
      tableReady={state.tableReady}
      failedSyncCount={failedCount}
      failedSyncs={failedSyncs}
      lastMemberSyncAt={state.lastMemberSyncAt}
      lastMemberSyncOk={state.lastMemberSyncOk}
      lastMemberSyncSummary={state.lastMemberSyncSummary}
      oauthConfigured={isOAuthConfigured()}
      oauthConnected={oauth.connected}
      oauthAccountEmail={oauth.accountEmail}
      oauthConnectedAt={oauth.connectedAt}
    />
  );
}
