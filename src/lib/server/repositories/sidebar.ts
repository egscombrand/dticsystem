import "server-only";
import { sql } from "@/lib/server/db";
import { DEFAULT_MENU, type MenuIcon, type MenuRow } from "@/lib/menu";
import type { Capability, Role } from "@/lib/auth/permissions";
import { DEFAULT_SITE, type SiteSettings } from "@/lib/server/repositories/site";

/**
 * Menu sidebar + pengaturan website dalam SATU query (satu round trip per render panel).
 * Bila tabel atau baris belum ada, memakai default; bila query gagal, pemanggil memakai default.
 */
export async function loadSidebarConfig(): Promise<{ items: MenuRow[]; site: SiteSettings }> {
  const rows = await sql()<
    {
      system_name: string | null;
      tagline: string | null;
      sidebar_default_collapsed: boolean | null;
      key: string | null;
      parent_key: string | null;
      label: string | null;
      href: string | null;
      icon: MenuIcon | null;
      required_capability: Capability | null;
      allowed_roles: Role[] | null;
      is_visible: boolean | null;
      is_core: boolean | null;
      sort_order: number | null;
    }[]
  >`
    select s.system_name, s.tagline, s.sidebar_default_collapsed,
           m.key, m.parent_key, m.label, m.href, m.icon, m.required_capability, m.allowed_roles, m.is_visible, m.is_core, m.sort_order
    from (select 1) as anchor
    left join site_settings s on s.id = 1
    left join sidebar_menu_items m on true
    order by m.sort_order, m.label`;

  const first = rows[0];
  const site: SiteSettings = first?.system_name
    ? { systemName: first.system_name, tagline: first.tagline ?? "", sidebarDefaultCollapsed: first.sidebar_default_collapsed ?? false }
    : DEFAULT_SITE;
  const items: MenuRow[] = rows
    .filter((r) => r.key !== null)
    .map((r) => ({
      key: r.key!,
      parentKey: r.parent_key,
      label: r.label!,
      href: r.href!,
      icon: r.icon!,
      requiredCapability: r.required_capability!,
      allowedRoles: r.allowed_roles ?? [],
      isVisible: r.is_visible ?? false,
      isCore: r.is_core ?? false,
      sortOrder: r.sort_order ?? 0,
    }));
  return { items: items.length ? items : DEFAULT_MENU, site };
}
