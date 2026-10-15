import "server-only";
import type { Capability, Role } from "@/lib/auth/permissions";
import { DEFAULT_MENU, validateMenuPatch, type MenuIcon, type MenuPatch, type MenuRow } from "@/lib/menu";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError } from "@/lib/server/errors";

type DbMenuRow = {
  key: string;
  parent_key: string | null;
  label: string;
  href: string;
  icon: MenuIcon;
  required_capability: Capability;
  allowed_roles: Role[];
  is_visible: boolean;
  is_core: boolean;
  sort_order: number;
};

const toMenuRow = (r: DbMenuRow): MenuRow => ({
  key: r.key,
  parentKey: r.parent_key,
  label: r.label,
  href: r.href,
  icon: r.icon,
  requiredCapability: r.required_capability,
  allowedRoles: r.allowed_roles,
  isVisible: r.is_visible,
  isCore: r.is_core,
  sortOrder: r.sort_order,
});

export async function listMenuItems(): Promise<MenuRow[]> {
  const rows = await sql()<DbMenuRow[]>`
    select key, parent_key, label, href, icon, required_capability, allowed_roles, is_visible, is_core, sort_order
    from sidebar_menu_items
    order by sort_order, label`;
  return rows.map(toMenuRow);
}

/** Ubah satu menu. Validasi aplikasi dulu (pesan jelas), database tetap menjadi penjaga terakhir. */
export async function updateMenuItem(key: string, patch: MenuPatch, actorId: string): Promise<void> {
  const all = await listMenuItems();
  const current = all.find((i) => i.key === key);
  if (!current) throw new NotFoundError("Menu tidak ditemukan.");
  const problem = validateMenuPatch(current, patch, all);
  if (problem) throw new AppError(problem, 422);

  await sql().begin(async (tx) => {
    await tx`
      update sidebar_menu_items set
        label = coalesce(${patch.label ?? null}, label),
        is_visible = coalesce(${patch.isVisible ?? null}, is_visible),
        sort_order = coalesce(${patch.sortOrder ?? null}, sort_order),
        allowed_roles = coalesce(${patch.allowedRoles ?? null}::text[], allowed_roles)
      where key = ${key}`;
    await tx`insert into auth_audit_log (actor_user_id, action, detail)
             values (${actorId}, 'menu_updated', ${tx.json({ key, changes: patch })})`;
  });
}

/** Kembalikan semua menu ke pengaturan awal (sama dengan seed migrasi). Menu inti tetap terlihat. */
export async function resetMenuItems(actorId: string): Promise<void> {
  await sql().begin(async (tx) => {
    for (const item of DEFAULT_MENU) {
      await tx`
        update sidebar_menu_items set label = ${item.label}, is_visible = true, sort_order = ${item.sortOrder},
          allowed_roles = ${item.allowedRoles}::text[]
        where key = ${item.key}`;
    }
    await tx`insert into auth_audit_log (actor_user_id, action, detail)
             values (${actorId}, 'menu_reset', ${tx.json({})})`;
  });
}
