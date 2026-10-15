import "server-only";
import { sql } from "@/lib/server/db";

export type SiteSettings = { systemName: string; tagline: string; sidebarDefaultCollapsed: boolean };

/** Nilai awal bila tabel/baris belum terbaca. Sama dengan seed migrasi. */
export const DEFAULT_SITE: SiteSettings = {
  systemName: "DTIC Connect",
  tagline: "One Portal for Creative & IT Requests",
  sidebarDefaultCollapsed: false,
};

export async function getSiteSettings(): Promise<SiteSettings> {
  const rows = await sql()<{ system_name: string; tagline: string; sidebar_default_collapsed: boolean }[]>`
    select system_name, tagline, sidebar_default_collapsed from site_settings where id = 1`;
  const r = rows[0];
  if (!r) return DEFAULT_SITE;
  return { systemName: r.system_name, tagline: r.tagline, sidebarDefaultCollapsed: r.sidebar_default_collapsed };
}

export async function updateSiteSettings(input: SiteSettings, actorId: string): Promise<void> {
  await sql().begin(async (tx) => {
    await tx`
      update site_settings set system_name = ${input.systemName}, tagline = ${input.tagline},
        sidebar_default_collapsed = ${input.sidebarDefaultCollapsed}, updated_by = ${actorId}
      where id = 1`;
    await tx`insert into auth_audit_log (actor_user_id, action, detail)
             values (${actorId}, 'site_updated', ${tx.json({ ...input })})`;
  });
}
