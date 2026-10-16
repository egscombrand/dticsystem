import { authorize, canAccessOrder } from "@/lib/server/auth";
import { NotFoundError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json } from "@/lib/server/http";
import { deleteDraftResult } from "@/lib/server/repositories/results";

/** Hapus file hasil yang masih draf (belum diserahkan). Hanya pengunggahnya atau Super Admin. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/results/[fileId]">) {
  const auth = await authorize(request, "orders.workflow");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id, fileId } = await ctx.params;
    assertUuid(id, "Order");
    assertUuid(fileId, "File");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    await deleteDraftResult(id, fileId, { userId: auth.session.userId, isSuperAdmin: auth.session.role === "super_admin" });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "DELETE order result file");
  }
}
