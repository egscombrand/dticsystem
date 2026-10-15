import { z } from "zod";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordPolicyError } from "@/lib/auth/password.mjs";
import { ROLES } from "@/lib/auth/permissions";

const name = z.string({ error: "Nama wajib diisi." }).trim().min(2, "Nama minimal 2 karakter.").max(120, "Nama maksimal 120 karakter.");
const email = z
  .string({ error: "Email wajib diisi." })
  .trim()
  .toLowerCase()
  .min(5, "Email wajib diisi.")
  .max(160, "Email maksimal 160 karakter.")
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Format email tidak valid.");
const role = z.enum(ROLES, { error: "Role tidak valid. Pilih Super Admin, Manager, atau Staff." });
const memberId = z.uuid({ error: "Member tidak valid." }).nullable();

export const userCreateSchema = z
  .object({
    fullName: name,
    email,
    role,
    memberId: memberId.optional().transform((v) => v ?? null),
    password: z
      .string({ error: "Kata sandi awal wajib diisi." })
      .min(MIN_PASSWORD_LENGTH, `Kata sandi awal minimal ${MIN_PASSWORD_LENGTH} karakter.`)
      .max(MAX_PASSWORD_LENGTH, `Kata sandi maksimal ${MAX_PASSWORD_LENGTH} karakter.`)
      .superRefine((v, ctx) => {
        const err = passwordPolicyError(v);
        if (err) ctx.addIssue({ code: "custom", message: err });
      }),
  })
  .strict();

export const userUpdateSchema = z
  .object({
    fullName: name.optional(),
    role: role.optional(),
    memberId: memberId.optional(),
    isActive: z.boolean({ error: "Status aktif tidak valid." }).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Tidak ada perubahan." });

export const passwordResetSchema = z
  .object({
    password: z
      .string({ error: "Kata sandi baru wajib diisi." })
      .min(MIN_PASSWORD_LENGTH, `Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter.`)
      .max(MAX_PASSWORD_LENGTH)
      .superRefine((v, ctx) => {
        const err = passwordPolicyError(v);
        if (err) ctx.addIssue({ code: "custom", message: err });
      }),
  })
  .strict();
