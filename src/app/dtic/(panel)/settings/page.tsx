import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { can } from "@/lib/auth/permissions";
import { getCurrentSession } from "@/lib/server/auth";

export default function SettingsIndex() {
  return (
    <Suspense fallback={null}>
      <Target />
    </Suspense>
  );
}

async function Target(): Promise<null> {
  await connection();
  const session = await getCurrentSession();
  if (!session) redirect("/dtic/login");
  redirect(can(session.role, "master.manage") ? "/dtic/settings/brands" : "/dtic/settings/members");
}
