import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/server/auth";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { MasterDataManager } from "@/components/settings/master-data-manager";
import { MembersManager } from "@/components/settings/members-manager";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { BrandListSkeleton } from "@/components/ui/skeletons";
import { ENTITY_DEFS, isMasterEntity, MASTER_ENTITIES, type MasterEntity } from "@/lib/master-data";
import { listDepartmentOptions, listMasterRows, listTeamAdminOptions } from "@/lib/server/repositories/master-data";

export const metadata: Metadata = { title: "Pengaturan" };

export function generateStaticParams() {
  return MASTER_ENTITIES.map((entity) => ({ entity }));
}

export default function SettingsPage({ params }: PageProps<"/dtic/settings/[entity]">) {
  return (
    <>
      <PageHeader
        title="Pengaturan"
        description="Data master DTIC. Perubahan langsung dipakai form client dan dashboard tanpa mengubah kode."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Pengaturan" }]}
      />
      <Suspense fallback={<BrandListSkeleton />}>
        <SettingsContent params={params} />
      </Suspense>
    </>
  );
}

async function SettingsContent({ params }: { params: PageProps<"/dtic/settings/[entity]">["params"] }) {
  const { entity } = await params;
  if (!isMasterEntity(entity)) notFound();
  await connection();
  const session = await requireSession();
  // Master data hanya Super Admin. Manager boleh melihat daftar anggota (read-only).
  const canManage = can(session.role, "master.manage");
  if (!canManage && !(entity === "members" && can(session.role, "members.view"))) redirect("/dtic/unauthorized");
  const visible = canManage ? MASTER_ENTITIES : (["members"] as const);
  const [rows, departments, teams] = await Promise.all([
    listMasterRows(entity),
    entity === "members" ? listDepartmentOptions() : Promise.resolve([]),
    entity === "order-types" ? listTeamAdminOptions() : Promise.resolve([]),
  ]);
  const placeholderBrands = entity === "brands" ? rows.filter((r) => /^Brand \d+$/.test(String(r.values.name))).length : 0;
  // Identitas Telegram anggota hanya untuk Super Admin: data dikosongkan di server sebelum dikirim ke Manager.
  const memberRows = entity === "members" && !canManage
    ? rows.map((r) => ({ ...r, values: { ...r.values, telegramDisplayName: null, telegramUsername: null, telegramUserId: null, telegramStatus: null } }))
    : rows;

  return (
    <div className="max-w-5xl">
      <SettingsTabs active={entity as MasterEntity} entities={visible} />
      {placeholderBrands > 0 && (
        <Alert kind="info" title="Nama brand pemohon masih sementara" className="mb-4">
          {placeholderBrands} brand masih memakai nama sementara. Jalankan migration terbaru atau ganti namanya di sini.
        </Alert>
      )}
      {entity === "members" ? (
        <MembersManager rows={memberRows} departments={departments} readOnly={!canManage} />
      ) : (
        <MasterDataManager entity={entity} def={ENTITY_DEFS[entity]} rows={rows} departments={departments} teams={teams} readOnly={!canManage} />
      )}
    </div>
  );
}
