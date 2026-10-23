import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { addFeedbackNote } from "@/lib/server/repositories/feedback";
import { toFieldErrors } from "@/lib/validation/common";
import { feedbackNoteSchema } from "@/lib/validation/feedback";

/** Catatan internal Super Admin — TIDAK PERNAH terlihat pelapor (lihat visible_to_reporter di repository). */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/feedback/[id]/note">) {
  const auth = await authorize(request, "feedback.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Tiket");
    const parsed = feedbackNoteSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Catatan wajib diisi.", 422, toFieldErrors(parsed.error));
    await addFeedbackNote(id, parsed.data.message, { userId: auth.session.userId, name: auth.session.name });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "POST feedback/[id]/note");
  }
}
