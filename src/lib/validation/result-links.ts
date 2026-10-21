import { z } from "zod";

/** Link hasil pekerjaan (website/repo/hosting) — selalu https; http ditolak (kebijakan keamanan default). */
export const resultLinkSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "URL hasil wajib diisi.")
    .max(2048, "URL terlalu panjang.")
    .transform((v, ctx) => {
      let u: URL;
      try {
        u = new URL(v);
      } catch {
        ctx.addIssue({ code: "custom", message: "URL tidak valid. Sertakan https:// di depan tautan." });
        return z.NEVER;
      }
      if (u.protocol !== "https:") {
        ctx.addIssue({ code: "custom", message: "Tautan hasil wajib https." });
        return z.NEVER;
      }
      return u.toString();
    }),
  title: z.string().trim().min(1, "Judul hasil wajib diisi.").max(200, "Judul terlalu panjang."),
  description: z
    .string()
    .trim()
    .max(1000, "Keterangan terlalu panjang.")
    .optional()
    .transform((v) => (v ? v : null)),
});
