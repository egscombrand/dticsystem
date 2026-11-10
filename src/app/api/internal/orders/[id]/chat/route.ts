import { authorize, canAccessOrder } from "@/lib/server/auth";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { readForm } from "@/lib/server/collab-http";
import { assertSameOrigin, assertUuid, errorResponse, json } from "@/lib/server/http";
import { internalChatRead, internalChatSend } from "@/lib/server/services/collab";

/**
 * Diskusi order (sisi internal) — dasar untuk dashboard PIC/Manager/Admin. Akses: PIC yang ditugaskan, Manager, Super Admin
 * (Staff lain → 404). Pesan dikirim atas nama akun yang login; peran dicatat server (tidak dari body).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/chat">) {
  const auth = await authorize(request, "dashboard.view");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    return json(await internalChatRead(auth.session, id, new URL(request.url).searchParams.get("after")));
  } catch (error) {
    return errorResponse(error, "GET order chat");
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/chat">) {
  const auth = await authorize(request, "dashboard.view");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) throw new AppError("Format permintaan tidak valid.", 400);
    return json(await internalChatSend(auth.session, id, await readForm(request)));
  } catch (error) {
    return errorResponse(error, "POST order chat");
  }
}
