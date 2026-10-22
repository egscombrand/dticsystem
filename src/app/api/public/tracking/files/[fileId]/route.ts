import { DriveNotConfiguredError, driveClient } from "@/lib/server/drive";
import { NotFoundError } from "@/lib/server/errors";
import { assertUuid, errorResponse, json } from "@/lib/server/http";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { findOrderForTracking, getAttachment, isResultFileDeliveredToRequester } from "@/lib/server/repositories/orders";
import { normalizeOrderNumber, ORDER_NUMBER_RE } from "@/lib/server/services/tracking";
import { storage } from "@/lib/server/storage";

const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

function contentDisposition(kind: "inline" | "attachment", fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Unduh/lihat SATU file hasil yang BENAR-BENAR sudah diajukan kepada pemohon (lihat
 * isResultFileDeliveredToRequester) — bukan rute umum untuk sembarang lampiran. Dua syarat sekaligus
 * (seperti pencarian riwayat publik lainnya): nomor order YANG BENAR di query `?order=`, DAN fileId harus
 * tercatat pada peristiwa 'delivery_recorded' order itu. Draf internal PIC yang belum diajukan tidak pernah
 * bisa diakses lewat jalur ini walau ID file-nya diketahui.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/public/tracking/files/[fileId]">) {
  try {
    const limit = rateLimit(`track-file:${clientIp(request)}`, 60, 15 * 60_000);
    if (!limit.ok) return json({ error: "Terlalu banyak permintaan. Coba lagi beberapa saat lagi." }, 429, { "Retry-After": String(limit.retryAfterSeconds) });

    const { fileId } = await ctx.params;
    assertUuid(fileId, "Berkas");
    const rawOrderNumber = new URL(request.url).searchParams.get("order") ?? "";
    const orderNumber = normalizeOrderNumber(rawOrderNumber);
    if (!ORDER_NUMBER_RE.test(orderNumber)) throw new NotFoundError("Berkas tidak ditemukan.");

    const order = await findOrderForTracking(orderNumber);
    if (!order) throw new NotFoundError("Berkas tidak ditemukan.");

    const attachment = await getAttachment(fileId);
    if (!attachment || attachment.order_id !== order.id) throw new NotFoundError("Berkas tidak ditemukan.");
    if (!(await isResultFileDeliveredToRequester(order.id, fileId))) throw new NotFoundError("Berkas tidak ditemukan.");

    const body = attachment.drive_file_id ? await (await driveClient()).downloadFile(attachment.drive_file_id) : attachment.storage_path ? await storage().get(attachment.storage_path) : null;
    if (!body) throw new NotFoundError("Berkas tidak ditemukan di penyimpanan.");

    const wantsInline = new URL(request.url).searchParams.get("inline") === "1";
    const inline = wantsInline && INLINE_TYPES.has(attachment.mime_type);
    return new Response(body, {
      headers: {
        "Content-Type": attachment.mime_type,
        "Content-Length": String(attachment.file_size),
        "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", attachment.file_name),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof DriveNotConfiguredError) {
      console.error("[tracking] Drive tidak terkonfigurasi:", error.message);
      return json({ error: "Berkas sedang tidak dapat diakses. Coba lagi nanti." }, 503);
    }
    return errorResponse(error, "GET public tracking file");
  }
}
