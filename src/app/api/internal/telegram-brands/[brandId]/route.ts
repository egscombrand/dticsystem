import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { disconnectChannel, parseBrandTarget, updateBrandSettings } from "@/lib/server/repositories/telegram-brands";
import { recordAudit } from "@/lib/server/repositories/audit";
import { recoverAwaitingNotifications } from "@/lib/server/services/telegram";
import { telegramSettingsSchema } from "@/lib/validation/telegram-brand";
import { toFieldErrors } from "@/lib/validation/common";

/** Ubah jenis notifikasi & status aktif grup (Super Admin). Aktivasi hanya untuk grup terverifikasi. */
export async function PUT(request: Request, ctx: RouteContext<"/api/internal/telegram-brands/[brandId]">) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { brandId } = await ctx.params;
    const target = parseBrandTarget(brandId);
    const parsed = telegramSettingsSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali pengaturan Telegram.", 422, toFieldErrors(parsed.error));
    await updateBrandSettings(target, parsed.data, auth.session.userId);
    // Grup aktif: event yang menunggu tujuan langsung dipulihkan (tanpa event/pengajuan baru).
    const recovered = parsed.data.isActive ? await recoverAwaitingNotifications() : 0;
    return json({ ok: true, recovered });
  } catch (error) {
    return errorResponse(error, "PUT telegram-brands");
  }
}

/**
 * Putuskan grup Telegram dari brand (atau Grup Default). Hanya Super Admin. Tidak menghapus order atau riwayat;
 * notifikasi pengajuan yang belum terkirim dirutekan ulang (Grup Default bila aktif) atau menunggu tujuan.
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/internal/telegram-brands/[brandId]">) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { brandId } = await ctx.params;
    const target = parseBrandTarget(brandId);
    const { chatTitle, requeued } = await disconnectChannel(target);
    await recordAudit(auth.session.userId, "telegram_group_disconnected", { target: target ?? "default", chat: chatTitle, requeued });
    const recovered = await recoverAwaitingNotifications();
    return json({ ok: true, requeued, recovered });
  } catch (error) {
    return errorResponse(error, "DELETE telegram-brands");
  }
}
