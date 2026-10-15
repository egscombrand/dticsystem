import { z } from "zod";
import { MAX_LINK_LENGTH } from "@/lib/telegram-link";
import { TELEGRAM_EVENT_TYPES, type TelegramEventType } from "@/lib/telegram-routing";

/** Verifikasi grup dari link. Chat ID TIDAK diterima dari klien: hanya link yang diverifikasi backend. */
export const telegramVerifySchema = z
  .object({
    link: z.string().max(MAX_LINK_LENGTH, "Link terlalu panjang."),
    replace: z.boolean().optional(),
  })
  .strict();

/** Pengaturan grup yang sudah ada: status aktif dan jenis notifikasi. */
export const telegramSettingsSchema = z
  .object({
    isActive: z.boolean(),
    events: z.object(Object.fromEntries(TELEGRAM_EVENT_TYPES.map((e) => [e, z.boolean()])) as Record<TelegramEventType, z.ZodBoolean>).strict(),
  })
  .strict();
