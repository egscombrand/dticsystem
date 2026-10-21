/**
 * Logika menu sidebar (murni, tanpa database). Dipakai server (filter) dan diuji unit.
 *
 * Aturan keamanan:
 *  - Role yang melihat menu = irisan allowed_roles DAN role yang memiliki required_capability.
 *    Konfigurasi menu TIDAK PERNAH bisa memberi akses di atas kapabilitas server.
 *  - Menu inti selalu terlihat dan selalu mencakup super_admin.
 */
import { can, isRole, ROLES, type Capability, type Role } from "@/lib/auth/permissions";

export type MenuIcon = "dashboard" | "list" | "kanban" | "calendar" | "file-plus" | "users" | "settings" | "shield" | "history" | "sliders" | "globe" | "database" | "layers";

export type MenuRow = {
  key: string;
  parentKey: string | null;
  label: string;
  href: string;
  icon: MenuIcon;
  requiredCapability: Capability;
  allowedRoles: Role[];
  isVisible: boolean;
  isCore: boolean;
  sortOrder: number;
};

export type MenuNode = { key: string; label: string; href: string; icon: MenuIcon; children: MenuNode[] };

/** Role yang secara kapabilitas boleh memakai menu ini. */
export function capableRoles(item: Pick<MenuRow, "requiredCapability">): Role[] {
  return ROLES.filter((r) => can(r, item.requiredCapability));
}

/** Role efektif = allowed_roles ∩ role yang memiliki kapabilitas. */
export function effectiveRoles(item: MenuRow): Role[] {
  const capable = new Set(capableRoles(item));
  return item.allowedRoles.filter((r) => capable.has(r));
}

export function isMenuVisibleFor(item: MenuRow, role: Role): boolean {
  return item.isVisible && effectiveRoles(item).includes(role);
}

/** Susun pohon menu untuk satu role. Anak hanya tampil bila induknya juga tampil. */
export function buildMenuTree(items: MenuRow[], role: Role): MenuNode[] {
  const visible = items.filter((i) => isMenuVisibleFor(i, role));
  const sorted = [...visible].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  // Submenu hanya dirender di bawah induk yang tampil; bila induk disembunyikan, submenu ikut hilang.
  const toNode = (i: MenuRow): MenuNode => ({
    key: i.key,
    label: i.label,
    href: i.href,
    icon: i.icon,
    children: sorted.filter((c) => c.parentKey === i.key).map(toNode),
  });
  return sorted.filter((i) => !i.parentKey).map(toNode);
}

/** Menu default (dipakai bila konfigurasi database tidak terbaca). Sama dengan seed migration. */
export const DEFAULT_MENU: MenuRow[] = [
  { key: "dashboard", parentKey: null, label: "Dashboard", href: "/dtic/dashboard", icon: "dashboard", requiredCapability: "dashboard.view", allowedRoles: ["super_admin", "manager", "staff"], isVisible: true, isCore: true, sortOrder: 10 },
  { key: "orders", parentKey: null, label: "Pengelolaan Pekerjaan", href: "/dtic/orders", icon: "list", requiredCapability: "dashboard.view", allowedRoles: ["super_admin", "manager", "staff"], isVisible: true, isCore: false, sortOrder: 20 },
  { key: "workboard", parentKey: null, label: "Workboard", href: "/dtic/workboard", icon: "kanban", requiredCapability: "dashboard.view", allowedRoles: ["super_admin", "manager", "staff"], isVisible: true, isCore: false, sortOrder: 30 },
  { key: "distribusi", parentKey: null, label: "Distribusi Pekerjaan", href: "/dtic/distribusi", icon: "users", requiredCapability: "orders.view_all", allowedRoles: ["super_admin", "manager"], isVisible: true, isCore: false, sortOrder: 36 },
  { key: "workload", parentKey: null, label: "Beban Kerja Tim", href: "/dtic/workload", icon: "users", requiredCapability: "orders.view_all", allowedRoles: ["super_admin", "manager"], isVisible: true, isCore: false, sortOrder: 35 },
  { key: "calendar", parentKey: null, label: "Kalender", href: "/dtic/calendar", icon: "calendar", requiredCapability: "dashboard.view", allowedRoles: ["super_admin", "manager", "staff"], isVisible: true, isCore: false, sortOrder: 40 },
  { key: "intake", parentKey: null, label: "Form Pengajuan", href: "/", icon: "file-plus", requiredCapability: "dashboard.view", allowedRoles: ["manager"], isVisible: true, isCore: false, sortOrder: 50 },
  { key: "members", parentKey: null, label: "Anggota DTIC", href: "/dtic/settings/members", icon: "users", requiredCapability: "members.view", allowedRoles: ["super_admin", "manager"], isVisible: true, isCore: false, sortOrder: 60 },
  { key: "settings", parentKey: null, label: "Pengaturan", href: "/dtic/settings", icon: "settings", requiredCapability: "master.manage", allowedRoles: ["super_admin"], isVisible: true, isCore: false, sortOrder: 70 },
  { key: "master", parentKey: "settings", label: "Master Data", href: "/dtic/settings/brands", icon: "database", requiredCapability: "master.manage", allowedRoles: ["super_admin"], isVisible: true, isCore: false, sortOrder: 71 },
  { key: "website", parentKey: "settings", label: "Pengaturan Website", href: "/dtic/settings/website", icon: "globe", requiredCapability: "site.manage", allowedRoles: ["super_admin"], isVisible: true, isCore: true, sortOrder: 72 },
  { key: "menu", parentKey: "settings", label: "Pengaturan Menu", href: "/dtic/settings/menu", icon: "sliders", requiredCapability: "site.manage", allowedRoles: ["super_admin"], isVisible: true, isCore: true, sortOrder: 73 },
  { key: "users", parentKey: null, label: "Pengguna & Role", href: "/dtic/settings/users", icon: "shield", requiredCapability: "users.manage", allowedRoles: ["super_admin"], isVisible: true, isCore: true, sortOrder: 80 },
  { key: "integrations", parentKey: "settings", label: "Integrasi Telegram", href: "/dtic/settings/integrations", icon: "layers", requiredCapability: "site.manage", allowedRoles: ["super_admin"], isVisible: true, isCore: true, sortOrder: 74 },
  { key: "google_drive", parentKey: "settings", label: "Google Drive", href: "/dtic/settings/integrations/google-drive", icon: "layers", requiredCapability: "site.manage", allowedRoles: ["super_admin"], isVisible: true, isCore: false, sortOrder: 75 },
  { key: "audit", parentKey: null, label: "Audit Aktivitas", href: "/dtic/settings/audit", icon: "history", requiredCapability: "audit.view", allowedRoles: ["super_admin"], isVisible: true, isCore: true, sortOrder: 90 },
];

export type MenuPatch = { label?: string; isVisible?: boolean; sortOrder?: number; allowedRoles?: Role[]; parentKey?: string | null };

/**
 * Validasi perubahan menu oleh Super Admin. Mengembalikan pesan galat atau null.
 * Menolak: menyembunyikan/menghapus menu inti, role di luar kapabilitas, dan induk yang tidak ada.
 */
export function validateMenuPatch(current: MenuRow, patch: MenuPatch, all: MenuRow[]): string | null {
  if (patch.allowedRoles !== undefined) {
    if (!Array.isArray(patch.allowedRoles) || patch.allowedRoles.length === 0) return "Pilih minimal satu role.";
    if (!patch.allowedRoles.every(isRole)) return "Role tidak valid.";
    const capable = new Set(capableRoles(current));
    const bad = patch.allowedRoles.filter((r) => !capable.has(r));
    if (bad.length) return `Role ${bad.join(", ")} tidak memiliki izin untuk menu ini.`;
    if (current.isCore && !patch.allowedRoles.includes("super_admin")) return "Menu inti harus tetap dapat diakses Super Admin.";
    if (current.key === "intake" && patch.allowedRoles.includes("super_admin"))
      return "Form Pengajuan bukan menu Super Admin. Pemohon memakai halaman publik.";
  }
  if (current.isCore && patch.isVisible === false) return "Menu inti tidak dapat disembunyikan.";
  if (patch.parentKey !== undefined && patch.parentKey !== null) {
    if (patch.parentKey === current.key) return "Menu tidak boleh menjadi induk dirinya sendiri.";
    const parent = all.find((i) => i.key === patch.parentKey);
    if (!parent) return "Induk menu tidak ditemukan.";
    if (parent.parentKey) return "Submenu hanya satu tingkat.";
  }
  if (patch.label !== undefined && (patch.label.trim().length < 1 || patch.label.length > 60)) return "Label 1–60 karakter.";
  return null;
}
