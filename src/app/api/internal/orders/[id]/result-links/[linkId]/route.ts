import { authorize, canAccessOrder } from "@/lib/server/auth";
import { NotFoundError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json } from "@/lib/server/http";
import { deleteResultLink } from "@/lib/server/repositories/results";

/** Hapus link hasil yang belum diserahkan. Hanya yang menambahkannya atau Super Admin. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/result-links/[linkId]">) {
  const auth = await authorize(request, "orders.workflow");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id, linkId } = await ctx.params;
    assertUuid(id, "Order");
    assertUuid(linkId, "Link");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    await deleteResultLink(id, linkId, { userId: auth.session.userId, isSuperAdmin: auth.session.role === "super_admin" });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "DELETE order result link");
  }
}
