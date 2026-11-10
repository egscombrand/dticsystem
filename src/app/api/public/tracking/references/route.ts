import { AppError } from "@/lib/server/errors";
import { readForm } from "@/lib/server/collab-http";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { publicReferenceUpload } from "@/lib/server/services/collab";

/** Pemohon menambah berkas referensi setelah pengajuan (multipart). Berkas lama tidak pernah ditimpa/dihapus. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) throw new AppError("Format permintaan tidak valid.", 400);
    return json(await publicReferenceUpload(request, await readForm(request)));
  } catch (error) {
    return errorResponse(error, "POST public references");
  }
}
