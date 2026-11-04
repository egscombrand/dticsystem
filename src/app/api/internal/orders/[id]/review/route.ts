import { authorize, canAccessOrder } from "@/lib/server/auth";
import { NotFoundError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { internalReviewAction, internalReviewRead } from "@/lib/server/services/review";

/**
 * Review Center (sisi internal). Hak akses di backend:
 *  - baca    : PIC yang ditugaskan, Manager, Super Admin (Staff lain → 404, tidak mengungkap keberadaan order);
 *  - tindakan: PIC yang ditugaskan dan Super Admin; Manager hanya memantau (403).
 * Tidak ada PUT/PATCH/DELETE: riwayat highlight/komentar/revisi hanya bertambah (405).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/review">) {
  const auth = await authorize(request, "dashboard.view");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    return json(await internalReviewRead(auth.session, id));
  } catch (error) {
    return errorResponse(error, "GET order review");
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/review">) {
  const auth = await authorize(request, "dashboard.view");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    const body = (await readJson(request)) as Record<string, unknown>;
    return json(await internalReviewAction(auth.session, id, body));
  } catch (error) {
    return errorResponse(error, "POST order review");
  }
}
