import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { changeOrderDeadline } from "@/lib/server/repositories/orders";
import { toFieldErrors } from "@/lib/validation/common";
import { deadlineChangeSchema } from "@/lib/validation/order";

/** Ubah tenggat pekerjaan. Hanya role dengan orders.update (Super Admin) — Manager dibatasi pada keputusan QC, bukan data pekerjaan; staff juga ditolak. */
export async function PUT(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/deadline">) {
  const auth = await authorize(request, "orders.update");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    const parsed = deadlineChangeSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali isian.", 422, toFieldErrors(parsed.error));
    const result = await changeOrderDeadline(id, parsed.data.deadlineAt, parsed.data.reason, {
      userId: auth.session.userId,
      name: auth.session.name,
    });
    return json({ ok: true, changed: result.changed, deadlineAt: result.newDeadline });
  } catch (error) {
    return errorResponse(error, "PUT order deadline");
  }
}
