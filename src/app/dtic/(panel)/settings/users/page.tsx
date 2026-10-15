import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { UsersManager } from "@/components/settings/users-manager";
import { PageHeader } from "@/components/ui/page-header";
import { BrandListSkeleton } from "@/components/ui/skeletons";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/server/auth";
import { listUsers } from "@/lib/server/repositories/users";
import { listMemberOptions } from "@/lib/server/repositories/master-data";

export const metadata: Metadata = { title: "Pengguna & Role" };

export default function UsersPage() {
  return (
    <>
      <PageHeader
        title="Pengguna & Role"
        description="Kelola akun internal DTIC. Hanya Super Admin yang dapat membuat akun, mengubah role, atau mereset kata sandi."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Pengguna & Role" }]}
      />
      <Suspense fallback={<BrandListSkeleton />}>
        <UsersContent />
      </Suspense>
    </>
  );
}

async function UsersContent() {
  await connection();
  const session = await requireSession();
  if (!can(session.role, "users.manage")) redirect("/dtic/unauthorized");
  const [users, members] = await Promise.all([listUsers(), listMemberOptions()]);
  return (
    <UsersManager
      currentUserId={session.userId}
      users={users}
      members={members.map((m) => ({ id: m.id, name: m.name, division: m.division, isActive: m.isActive }))}
    />
  );
}
