import { z } from "zod";

/**
 * Pengaturan website. Logo TIDAK didukung (belum ada penyimpanan file untuk logo),
 * jadi field logo sengaja tidak ada dan ditolak oleh .strict().
 */
export const siteSettingsSchema = z
  .object({
    systemName: z.string({ error: "Nama sistem wajib diisi." }).trim().min(2, "Nama sistem minimal 2 karakter.").max(60, "Nama sistem maksimal 60 karakter."),
    tagline: z.string().trim().max(120, "Tagline maksimal 120 karakter.").default(""),
    sidebarDefaultCollapsed: z.boolean({ error: "Pengaturan sidebar tidak valid." }),
  })
  .strict();
