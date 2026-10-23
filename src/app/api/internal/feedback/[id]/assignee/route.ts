import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { listInternalAssignees, updateFeedbackAssignee } from "@/lib/server/repositories/feedback";
import { toFieldErrors } from "@/lib/validation/common";
import { feedbackAssigneeSchema } from "@/lib/validation/feedback";

export async function POST(request: Request, ctx: RouteContext<"/api/internal/feedback/[id]/assignee">) {
  const auth = await authorize(request, "feedback.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Tiket");
    const parsed = feedbackAssigneeSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Penanggung jawab tidak valid.", 422, toFieldErrors(parsed.error));
    // Nama diambil dari server (bukan dipercaya dari klien) — mencegah detail peristiwa memuat nama palsu.
    let assigneeName: string | null = null;
    if (parsed.data.assigneeUserId) {
      const list = await listInternalAssignees();
      const match = list.find((a) => a.id === parsed.data.assigneeUserId);
      if (!match) throw new AppError("Penanggung jawab tidak ditemukan.", 422, { assigneeUserId: "Penanggung jawab tidak ditemukan." });
      assigneeName = match.fullName;
    }
    await updateFeedbackAssignee(id, parsed.data.assigneeUserId, assigneeName, { userId: auth.session.userId, name: auth.session.name });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "POST feedback/[id]/assignee");
  }
}
