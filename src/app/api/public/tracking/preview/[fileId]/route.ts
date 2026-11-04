import { NotFoundError } from "@/lib/server/errors";
import { assertUuid, errorResponse, json } from "@/lib/server/http";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { findOrderForTracking, getAttachment, isResultFileDeliveredToRequester } from "@/lib/server/repositories/orders";
import { convertPresentationToPdf, PDF_RESPONSE_HEADERS, readAttachmentBytes } from "@/lib/server/presentation-preview";
import { normalizeOrderNumber, ORDER_NUMBER_RE } from "@/lib/server/services/tracking";
import { getExtension } from "@/lib/files";

/** Pratinjau PowerPoint (PDF) untuk pemohon — syarat sama dengan unduh file publik: nomor order benar DAN file sudah diserahkan. */
export async function GET(request: Request, ctx: RouteContext<"/api/public/tracking/preview/[fileId]">) {
  try {
    const limit = rateLimit(`track-preview:${clientIp(request)}`, 40, 15 * 60_000);
    if (!limit.ok) return json({ error: "Terlalu banyak permintaan. Coba lagi beberapa saat lagi." }, 429, { "Retry-After": String(limit.retryAfterSeconds) });
    const { fileId } = await ctx.params;
    assertUuid(fileId, "Berkas");
    const orderNumber = normalizeOrderNumber(new URL(request.url).searchParams.get("order") ?? "");
    if (!ORDER_NUMBER_RE.test(orderNumber)) throw new NotFoundError("Berkas tidak ditemukan.");
    const order = await findOrderForTracking(orderNumber);
    if (!order) throw new NotFoundError("Berkas tidak ditemukan.");
    const a = await getAttachment(fileId);
    if (!a || a.order_id !== order.id || !(await isResultFileDeliveredToRequester(order.id, fileId))) throw new NotFoundError("Berkas tidak ditemukan.");
    const ext = getExtension(a.file_name);
    if (ext !== "ppt" && ext !== "pptx") throw new NotFoundError("Berkas tidak ditemukan.");
    const pdf = await convertPresentationToPdf(`${a.id}:${a.file_size}`, await readAttachmentBytes(a), ext);
    return new Response(new Uint8Array(pdf), { headers: { ...PDF_RESPONSE_HEADERS, "Content-Length": String(pdf.length) } });
  } catch (error) {
    return errorResponse(error, "GET public preview");
  }
}
