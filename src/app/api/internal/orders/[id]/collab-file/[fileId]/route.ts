import { authorize, canAccessOrder } from "@/lib/server/auth";
import { NotFoundError } from "@/lib/server/errors";
import { fileResponse } from "@/lib/server/collab-http";
import { assertUuid, errorResponse } from "@/lib/server/http";
import { internalCollabFile } from "@/lib/server/services/collab";

export async function GET(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/collab-file/[fileId]">) {
  const auth = await authorize(request, "dashboard.view");
  if (!auth.ok) return auth.response;
  try {
    const { id, fileId } = await ctx.params;
    assertUuid(id, "Order");
    assertUuid(fileId, "Berkas");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    return fileResponse(await internalCollabFile(id, fileId, new URL(request.url).searchParams.get("kind")), request);
  } catch (error) {
    return errorResponse(error, "GET order collab file");
  }
}
