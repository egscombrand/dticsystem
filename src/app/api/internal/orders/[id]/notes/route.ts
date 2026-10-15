import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { updateInternalNotes } from "@/lib/server/repositories/orders";
import { toFieldErrors } from "@/lib/validation/common";
import { internalNotesSchema } from "@/lib/validation/order";

export async function PUT(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/notes">) {
  const auth = await authorize(request, "orders.update");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    const parsed = internalNotesSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Catatan tidak valid.", 422, toFieldErrors(parsed.error));
    await updateInternalNotes(id, parsed.data.internalNotes);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "PUT order notes");
  }
}
