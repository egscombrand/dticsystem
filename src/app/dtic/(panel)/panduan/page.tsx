import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { TutorialHub } from "@/components/tutorial/tutorial-hub";
import { TutorialPreferences } from "@/components/tutorial/tutorial-preferences";
import { tutorialsForRole, type TutorialRole } from "@/lib/tutorials";
import { requireSession } from "@/lib/server/auth";
import type { Role } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "Panduan Penggunaan" };

/** Role dengan panduan interaktif terisi (lihat src/lib/tutorials.ts) dan tutorial pengenalan masing-masing. */
const ROLE_INTRO: Partial<Record<Role, string>> = {
  manager: "manager-dashboard",
  staff: "staff-dashboard",
};

/**
 * Panduan Penggunaan interaktif — HANYA role dengan panduan terisi (lihat ROLE_INTRO di atas / src/lib/tutorials.ts).
 * Pengamanan di sini (bukan hanya menu disembunyikan di sidebar, lihat src/lib/menu.ts "panduan") —
 * akses langsung lewat URL oleh role lain (mis. Super Admin, yang belum punya panduan sendiri) dialihkan
 * ke halaman tidak berwenang, konsisten dengan pola /dtic/distribusi (requireSession + pemeriksaan role
 * sebelum render apa pun). Setiap role hanya melihat tutorialnya sendiri — tidak pernah tutorial role lain.
 */
export default async function PanduanPage() {
  const session = await requireSession();
  const introId = ROLE_INTRO[session.role];
  if (!introId) redirect("/dtic/unauthorized");
  const tutorials = tutorialsForRole(session.role as TutorialRole);

  return (
    <>
      <PageHeader
        title="Panduan Penggunaan"
        description="Pelajari setiap fitur DTIC Nexus melalui panduan interaktif langkah demi langkah. Pilih panduan sesuai kebutuhan Anda, atau mulai dari pengenalan dashboard."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Panduan Penggunaan" }]}
      />
      <TutorialHub tutorials={tutorials} introId={introId} />
      <div className="mt-6">
        <TutorialPreferences />
      </div>
    </>
  );
}
