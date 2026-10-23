import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { updateFeedbackStatus } from "@/lib/server/repositories/feedback";
import { toFieldErrors } from "@/lib/validation/common";
import { feedbackStatusUpdateSchema } from "@/lib/validation/feedback";

/** Ubah status tindak lanjut tiket — hanya Super Admin (feedback.manage). Status TERPISAH dari status order terkait. */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/feedback/[id]/status">) {
  const auth = await authorize(request, "feedback.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Tiket");
    const parsed = feedbackStatusUpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali isian.", 422, toFieldErrors(parsed.error));
    await updateFeedbackStatus(id, parsed.data.status, { message: parsed.data.message, closeReason: parsed.data.closeReason, resolutionSummary: parsed.data.resolutionSummary }, { userId: auth.session.userId, name: auth.session.name });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "POST feedback/[id]/status");
  }
}
