import { AppError } from "@/lib/server/errors";
import { readForm } from "@/lib/server/collab-http";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { publicChatRead, publicChatSend } from "@/lib/server/services/collab";

/** Diskusi Pemohon ↔ PIC. GET = pesan setelah kursor `after` (polling). POST multipart = kirim pesan (+ lampiran). */
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    return json(await publicChatRead(request, q.get("order") ?? "", q.get("after")));
  } catch (error) {
    return errorResponse(error, "GET public chat");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) throw new AppError("Format permintaan tidak valid.", 400);
    return json(await publicChatSend(request, await readForm(request)));
  } catch (error) {
    return errorResponse(error, "POST public chat");
  }
}
