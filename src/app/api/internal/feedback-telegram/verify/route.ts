import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { verifyFeedbackGroup } from "@/lib/server/services/telegram-verify";
import { telegramVerifySchema } from "@/lib/validation/telegram-brand";
import { toFieldErrors } from "@/lib/validation/common";

const STATUS_CODE = { verified: 200, replace_required: 409 } as const;

/**
 * Verifikasi grup Telegram Tim IT dari link (Super Admin). Backend mengurai link, memeriksa identitas dan
 * keanggotaan bot lewat Bot API, lalu menyimpan chat ID hanya bila benar-benar terverifikasi.
 */
export async function POST(request: Request) {
  const auth = await authorize(request, "feedback.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const parsed = telegramVerifySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali link Telegram.", 422, toFieldErrors(parsed.error));
    const result = await verifyFeedbackGroup(parsed.data.link, parsed.data.replace === true, auth.session.userId);
    return json(result, result.ok ? STATUS_CODE.verified : (STATUS_CODE as Record<string, number>)[result.status] ?? 422);
  } catch (error) {
    return errorResponse(error, "POST feedback-telegram verify");
  }
}
