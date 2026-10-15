import { redirect } from "next/navigation";
import { AppFrame } from "@/components/layout/sidebar";
import { buildMenuTree } from "@/lib/menu";
import { isRole } from "@/lib/auth/permissions";
import { getCurrentSession } from "@/lib/server/auth";
import { DEFAULT_MENU } from "@/lib/menu";
import { loadSidebarConfig } from "@/lib/server/repositories/sidebar";
import { DEFAULT_SITE } from "@/lib/server/repositories/site";

/**
 * Pemeriksaan sesi untuk seluruh area internal (server-side). Tanpa sesi valid → login.
 * Menu & nama sistem dibaca dari database; bila gagal, memakai menu default agar
 * Super Admin tetap bisa masuk ke Pengaturan Menu untuk memperbaikinya.
 * Dipanggil di dalam <Suspense> (membaca cookie = runtime data).
 */
export async function PanelShell({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect("/dtic/login");
  if (!isRole(session.role)) redirect("/dtic/unauthorized");

  // Satu query untuk menu + pengaturan website; bila gagal, default agar navigasi tetap berfungsi.
  const { items, site } = await loadSidebarConfig().catch(() => ({ items: DEFAULT_MENU, site: DEFAULT_SITE }));

  return (
    <AppFrame
      role={session.role}
      name={session.name}
      menu={buildMenuTree(items, session.role)}
      systemName={site.systemName}
      tagline={site.tagline}
      defaultCollapsed={site.sidebarDefaultCollapsed}
    >
      {children}
    </AppFrame>
  );
}

