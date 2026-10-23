import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { updateFeedbackPriority } from "@/lib/server/repositories/feedback";
import { toFieldErrors } from "@/lib/validation/common";
import { feedbackPrioritySchema } from "@/lib/validation/feedback";

export async function POST(request: Request, ctx: RouteContext<"/api/internal/feedback/[id]/priority">) {
  const auth = await authorize(request, "feedback.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Tiket");
    const parsed = feedbackPrioritySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Prioritas tidak valid.", 422, toFieldErrors(parsed.error));
    await updateFeedbackPriority(id, parsed.data.priority, { userId: auth.session.userId, name: auth.session.name });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "POST feedback/[id]/priority");
  }
}
