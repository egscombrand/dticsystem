import { z } from "zod";
import { ROLES } from "@/lib/auth/permissions";

const label = z.string({ error: "Label wajib diisi." }).trim().min(1, "Label wajib diisi.").max(60, "Label maksimal 60 karakter.");
const sortOrder = z.number({ error: "Urutan tidak valid." }).int("Urutan harus bilangan bulat.").min(0).max(9999);
const roles = z.array(z.enum(ROLES, { error: "Role tidak valid." })).min(1, "Pilih minimal satu role.").max(3);

/** Perubahan menu oleh Super Admin. Kolom lain (href, ikon, kapabilitas) tidak bisa diubah dari UI. */
export const menuPatchSchema = z
  .object({
    label: label.optional(),
    isVisible: z.boolean({ error: "Visibilitas tidak valid." }).optional(),
    sortOrder: sortOrder.optional(),
    allowedRoles: roles.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Tidak ada perubahan." });
