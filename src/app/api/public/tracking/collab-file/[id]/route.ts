import { fileResponse } from "@/lib/server/collab-http";
import { assertUuid, errorResponse } from "@/lib/server/http";
import { publicCollabFile } from "@/lib/server/services/collab";

/** Unduh lampiran diskusi atau berkas referensi milik order yang nomornya benar (?order=&kind=chat|reference). */
export async function GET(request: Request, ctx: RouteContext<"/api/public/tracking/collab-file/[id]">) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "Berkas");
    const q = new URL(request.url).searchParams;
    return fileResponse(await publicCollabFile(request, q.get("order"), id, q.get("kind")), request);
  } catch (error) {
    return errorResponse(error, "GET public collab file");
  }
}
