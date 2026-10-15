/**
 * Matriks hak akses DTIC Connect (sumber kebenaran tunggal untuk server & UI).
 * UI memakai ini hanya untuk menampilkan menu; keputusan akses tetap dicek di server.
 */
export const ROLES = ["super_admin", "manager", "staff"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  manager: "Manager",
  staff: "Staff",
};

/** Kapabilitas → role yang diizinkan. */
export const CAPABILITIES = {
  /** Dashboard & menu dasar (staff hanya melihat data yang ditugaskan kepadanya). */
  "dashboard.view": ["super_admin", "manager", "staff"],
  /** Melihat seluruh order (tanpa pembatasan PIC). */
  "orders.view_all": ["super_admin", "manager"],
  /** Mengubah detail order, catatan internal, dan informasi untuk pemohon. */
  "orders.update": ["super_admin", "manager"],
  /** Menghapus order (termasuk lampiran). */
  "orders.delete": ["super_admin"],
  /** Menambah, menghapus, atau mengganti PIC (anggota tim yang sesuai kategori). Wajib alasan; dicatat di audit. */
  "orders.manage_pic": ["super_admin", "manager"],
  /** Mengubah status (aturan transisi di src/lib/workflow.ts). Staff hanya pada order miliknya; Manager memantau saja. */
  "orders.status": ["super_admin", "staff"],
  /** Mengelola data master (brand, divisi, member, jenis order, prioritas). */
  "master.manage": ["super_admin"],
  /** Melihat daftar anggota DTIC (read-only untuk manager). */
  "members.view": ["super_admin", "manager"],
  /** Mengelola akun pengguna & role. */
  "users.manage": ["super_admin"],
  /** Mengatur menu sidebar dan pengaturan website. */
  "site.manage": ["super_admin"],
  /** Melihat log audit aktivitas. */
  "audit.view": ["super_admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly Role[]).includes(role);
}

/** Role yang boleh membuat/mengubah akun: Super Admin saja. Manager tidak boleh membuat Super Admin. */
export function assignableRoles(actor: Role): Role[] {
  return actor === "super_admin" ? [...ROLES] : [];
}

export const SESSION_COOKIE = "dtic_session";
