import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { parseBrandTarget } from "@/lib/server/repositories/telegram-brands";
import { verifyBrandGroup } from "@/lib/server/services/telegram-verify";
import { recoverAwaitingNotifications } from "@/lib/server/services/telegram";
import { telegramVerifySchema } from "@/lib/validation/telegram-brand";
import { toFieldErrors } from "@/lib/validation/common";

const STATUS_CODE = { verified: 200, replace_required: 409 } as const;

/**
 * Verifikasi grup Telegram dari link untuk satu brand (Super Admin). Backend mengurai link, memeriksa
 * identitas dan keanggotaan bot lewat Bot API, lalu menyimpan chat ID hanya bila benar-benar terverifikasi.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/telegram-brands/[brandId]/verify">) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { brandId } = await ctx.params;
    const target = parseBrandTarget(brandId);
    const parsed = telegramVerifySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali link Telegram.", 422, toFieldErrors(parsed.error));
    const result = await verifyBrandGroup(target, parsed.data.link, parsed.data.replace === true, auth.session.userId);
    if (result.ok) await recoverAwaitingNotifications(); // grup yang sudah aktif bisa langsung menerima
    return json(result, result.ok ? STATUS_CODE.verified : (STATUS_CODE as Record<string, number>)[result.status] ?? 422);
  } catch (error) {
    return errorResponse(error, "POST telegram-brands verify");
  }
}
