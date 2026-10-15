import { z } from "zod";
import type { StatusTone } from "@/lib/status";
import { normalizeTelegramUserId, normalizeTelegramUsername, telegramNameRequirement } from "@/lib/member-telegram";

/**
 * Definisi data master yang dikelola dari halaman Pengaturan.
 * Isi datanya ada di database — file ini hanya mendeskripsikan bentuk field & validasi.
 */

export const MASTER_ENTITIES = ["brands", "departments", "members", "order-types", "priorities"] as const;
export type MasterEntity = (typeof MASTER_ENTITIES)[number];

export function isMasterEntity(v: unknown): v is MasterEntity {
  return typeof v === "string" && (MASTER_ENTITIES as readonly string[]).includes(v);
}

export const PRIORITY_TONES = ["muted", "neutral", "accent", "info", "success", "warning", "danger"] as const satisfies readonly StatusTone[];

const TONE_LABELS: Record<(typeof PRIORITY_TONES)[number], string> = {
  muted: "Abu-abu lembut",
  neutral: "Netral",
  accent: "Teal",
  info: "Biru",
  success: "Hijau",
  warning: "Amber",
  danger: "Merah",
};

export type FieldDef =
  | { key: string; label: string; type: "text"; required: boolean; max: number; hint?: string; mono?: boolean; createOnly?: boolean; slugFrom?: string }
  | { key: string; label: string; type: "select"; required: boolean; options: { value: string; label: string }[] | "departments" | "teams"; hint?: string }
  | { key: string; label: string; type: "boolean"; hint?: string }
  | { key: string; label: string; type: "number"; hint?: string };

export type EntityDef = {
  title: string;
  singular: string;
  description: string;
  /** Field yang ditampilkan sebagai judul baris. */
  primary: string;
  fields: FieldDef[];
};

const sortField: FieldDef = { key: "sortOrder", label: "Urutan", type: "number", hint: "Angka kecil tampil lebih dulu" };
const activeField = (hint: string): FieldDef => ({ key: "isActive", label: "Aktif", type: "boolean", hint });

export const ENTITY_DEFS: Record<MasterEntity, EntityDef> = {
  brands: {
    title: "Brand Pemohon",
    singular: "brand pemohon",
    description: "Brand/perusahaan yang mengajukan request desain ke DTIC. Brand aktif muncul di form client.",
    primary: "name",
    fields: [
      { key: "name", label: "Nama brand pemohon", type: "text", required: true, max: 80 },
      { key: "slug", label: "Slug", type: "text", required: true, max: 60, mono: true, slugFrom: "name", hint: "Huruf kecil, angka, tanda hubung" },
      sortField,
      activeField("Brand nonaktif tidak bisa dipilih pada pengajuan baru; order lama tetap terhubung."),
    ],
  },
  departments: {
    title: "Divisi",
    singular: "divisi",
    description: "Divisi internal tim DTIC.",
    primary: "name",
    fields: [
      { key: "name", label: "Nama divisi", type: "text", required: true, max: 80 },
      { key: "slug", label: "Slug", type: "text", required: true, max: 60, mono: true, slugFrom: "name", hint: "Huruf kecil, angka, tanda hubung" },
      sortField,
      activeField("Divisi nonaktif tidak bisa dipilih untuk member baru."),
    ],
  },
  members: {
    title: "Member DTIC",
    singular: "member",
    description: "Anggota tim DTIC beserta divisinya. Tidak ditampilkan ke client.",
    primary: "fullName",
    fields: [
      { key: "fullName", label: "Nama lengkap", type: "text", required: true, max: 120 },
      { key: "departmentId", label: "Divisi", type: "select", required: true, options: "departments" },
      { key: "position", label: "Jabatan", type: "text", required: true, max: 80, hint: "mis. Staff" },
      { key: "email", label: "Email", type: "text", required: false, max: 160 },
      { key: "telegramDisplayName", label: "Nama Telegram", type: "text", required: false, max: 80, hint: "Wajib bila ada username atau User ID Telegram." },
      { key: "telegramUsername", label: "Telegram username", type: "text", required: false, max: 40, mono: true, hint: "Tanpa @. Boleh kosong bila anggota tidak punya username." },
      { key: "telegramUserId", label: "Telegram User ID", type: "text", required: false, max: 20, mono: true, hint: "Angka. Kosongkan bila belum diketahui; jangan diisi tebakan." },
      sortField,
      activeField("Member nonaktif tetap tersimpan untuk riwayat."),
    ],
  },
  "order-types": {
    title: "Jenis Order",
    singular: "jenis order",
    description: "Pilihan Jenis Order Desain pada form client.",
    primary: "name",
    fields: [
      { key: "name", label: "Nama jenis order", type: "text", required: true, max: 60 },
      { key: "teamId", label: "Tim penanggung jawab (kategori)", type: "select", required: true, options: "teams", hint: "Seluruh anggota tim ini otomatis menjadi PIC" },
      { key: "requiresDetail", label: "Client menulis jenisnya sendiri", type: "boolean", hint: "Untuk opsi seperti \"Lainnya\"" },
      sortField,
      activeField("Jenis nonaktif tidak muncul di form; order lama tetap tersimpan."),
    ],
  },
  priorities: {
    title: "Prioritas",
    singular: "level prioritas",
    description: "Level urgensi order. Kode dipakai sebagai identifier pada order dan tidak bisa diubah.",
    primary: "name",
    fields: [
      { key: "code", label: "Kode", type: "text", required: true, max: 30, mono: true, createOnly: true, hint: "Huruf kecil/angka/_ , mis. urgent" },
      { key: "name", label: "Nama tampilan", type: "text", required: true, max: 40 },
      { key: "tone", label: "Warna badge", type: "select", required: true, options: PRIORITY_TONES.map((t) => ({ value: t, label: TONE_LABELS[t] })) },
      sortField,
      activeField("Level nonaktif tidak muncul di form; order lama tetap tersimpan."),
    ],
  },
};

// ---------------------------------------------------------------------------
// Validasi (dipakai server; field yang tidak dikenal ditolak → anti mass-assignment)
// ---------------------------------------------------------------------------

const name = (label: string, min: number, max: number) =>
  z.string({ error: `${label} wajib diisi.` }).trim().min(min, `${label} minimal ${min} karakter.`).max(max, `${label} maksimal ${max} karakter.`);
const slug = z
  .string({ error: "Slug wajib diisi." })
  .trim()
  .toLowerCase()
  .min(1, "Slug wajib diisi.")
  .max(60, "Slug maksimal 60 karakter.")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug hanya huruf kecil, angka, dan tanda hubung.");
/** Opsional: bila tidak dikirim, urutan lama dipertahankan (create → 0). */
const sortOrder = z.coerce.number({ error: "Urutan harus angka." }).int("Urutan harus bilangan bulat.").min(0, "Urutan minimal 0.").max(9999).optional();
const isActive = z.boolean({ error: "Status aktif tidak valid." }).default(true);

export const MASTER_SCHEMAS = {
  brands: z.object({ name: name("Nama brand", 1, 80), slug, sortOrder, isActive }).strict(),
  departments: z.object({ name: name("Nama divisi", 2, 80), slug, sortOrder, isActive }).strict(),
  members: z
    .object({
      fullName: name("Nama lengkap", 2, 120),
      departmentId: z.uuid({ error: "Pilih divisi." }),
      position: name("Jabatan", 2, 80),
      email: z
        .string()
        .trim()
        .max(160)
        .optional()
        .transform((v, ctx) => {
          if (!v) return null;
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
            ctx.addIssue({ code: "custom", message: "Format email tidak valid." });
            return z.NEVER;
          }
          return v.toLowerCase();
        }),
      telegramDisplayName: z.string().trim().max(80, "Nama Telegram maksimal 80 karakter.").optional().transform((v) => (v ? v : null)),
      telegramUsername: z.string().max(40).optional().transform((v, ctx) => {
        const n = normalizeTelegramUsername(v);
        if (n === "invalid") {
          ctx.addIssue({ code: "custom", message: "Username Telegram 5–32 karakter: huruf, angka, garis bawah; diawali huruf." });
          return z.NEVER;
        }
        return n;
      }),
      telegramUserId: z.string().max(20).optional().transform((v, ctx) => {
        const n = normalizeTelegramUserId(v);
        if (n === "invalid") {
          ctx.addIssue({ code: "custom", message: "Telegram User ID harus berupa angka tanpa awalan 0." });
          return z.NEVER;
        }
        return n;
      }),
      sortOrder,
      isActive,
    })
    .strict()
    .superRefine((v, ctx) => {
      const msg = telegramNameRequirement({ displayName: v.telegramDisplayName, username: v.telegramUsername, userId: v.telegramUserId });
      if (msg) ctx.addIssue({ code: "custom", path: ["telegramDisplayName"], message: msg });
    }),
  "order-types": z
    .object({ name: name("Nama jenis order", 2, 60), teamId: z.uuid({ error: "Pilih tim penanggung jawab." }), requiresDetail: z.boolean().default(false), sortOrder, isActive })
    .strict(),
  priorities: z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9_]{1,29}$/, "Kode 2–30 karakter: huruf kecil, angka, garis bawah; diawali huruf.")
        .optional(),
      name: name("Nama tampilan", 2, 40),
      tone: z.enum(PRIORITY_TONES, { error: "Pilih warna badge." }),
      sortOrder,
      isActive,
    })
    .strict(),
} satisfies Record<MasterEntity, z.ZodType>;

export type MasterRow = { id: string; values: Record<string, string | number | boolean | null>; usage: number; subtitle?: string };
