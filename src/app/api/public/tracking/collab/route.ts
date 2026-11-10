import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { publicCollabAction, publicCollabRead } from "@/lib/server/services/collab";

/** Brief (versi & usulan perubahan), berkas referensi, dan aktivitas untuk Pemohon. Tidak ada PUT/PATCH/DELETE. */
export async function GET(request: Request) {
  try {
    return json(await publicCollabRead(request, new URL(request.url).searchParams.get("order") ?? ""));
  } catch (error) {
    return errorResponse(error, "GET public collab");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJson(request)) as Record<string, unknown>;
    if (!body || typeof body !== "object") throw new AppError("Format permintaan tidak valid.", 400);
    return json(await publicCollabAction(request, body));
  } catch (error) {
    return errorResponse(error, "POST public collab");
  }
}
