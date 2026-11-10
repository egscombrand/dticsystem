import { authorize, canAccessOrder } from "@/lib/server/auth";
import { NotFoundError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { internalCollabAction, internalCollabRead } from "@/lib/server/services/collab";

/** Brief + versi + usulan perubahan + berkas referensi (internal). POST: action read | brief_accept | brief_reject. */
export async function GET(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/collab">) {
  const auth = await authorize(request, "dashboard.view");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    return json(await internalCollabRead(auth.session, id));
  } catch (error) {
    return errorResponse(error, "GET order collab");
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/collab">) {
  const auth = await authorize(request, "dashboard.view");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    return json(await internalCollabAction(auth.session, id, (await readJson(request)) as Record<string, unknown>));
  } catch (error) {
    return errorResponse(error, "POST order collab");
  }
}
