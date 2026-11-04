import { authorize, canAccessOrder } from "@/lib/server/auth";
import { NotFoundError } from "@/lib/server/errors";
import { assertUuid, errorResponse } from "@/lib/server/http";
import { getAttachment } from "@/lib/server/repositories/orders";
import { convertPresentationToPdf, PDF_RESPONSE_HEADERS, readAttachmentBytes } from "@/lib/server/presentation-preview";
import { getExtension } from "@/lib/files";

/** Pratinjau PowerPoint sebagai PDF (konversi sisi server, opsional) — hanya area internal & pihak yang berhak atas order-nya. */
export async function GET(request: Request, ctx: RouteContext<"/api/internal/attachments/[id]/preview">) {
  const auth = await authorize(request, "dashboard.view");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    assertUuid(id, "Dokumen");
    const a = await getAttachment(id);
    if (!a || !(await canAccessOrder(auth.session, a.order_id))) throw new NotFoundError("Dokumen tidak ditemukan.");
    const ext = getExtension(a.file_name);
    if (ext !== "ppt" && ext !== "pptx") throw new NotFoundError("Dokumen tidak ditemukan.");
    const pdf = await convertPresentationToPdf(`${a.id}:${a.file_size}`, await readAttachmentBytes(a), ext);
    return new Response(new Uint8Array(pdf), { headers: { ...PDF_RESPONSE_HEADERS, "Content-Length": String(pdf.length) } });
  } catch (error) {
    return errorResponse(error, "GET attachment preview");
  }
}
