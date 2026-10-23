import { NotFoundError } from "@/lib/server/errors";
import { assertUuid, errorResponse, json } from "@/lib/server/http";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { getFeedbackAttachment, getFeedbackTicketByNumber } from "@/lib/server/repositories/feedback";
import { storage } from "@/lib/server/storage";

const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

function contentDisposition(kind: "inline" | "attachment", fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Unduh/lihat SATU lampiran tiket Bantuan & Masukan — dua syarat sekaligus (sama seperti unduhan Riwayat
 * Request): nomor tiket YANG BENAR di query `?ticket=` DAN fileId harus benar-benar milik tiket itu.
 * Lampiran tiket LAIN tidak pernah bisa diakses lewat jalur ini walau ID-nya diketahui.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/public/feedback/attachments/[id]">) {
  try {
    const limit = rateLimit(`feedback-file:${clientIp(request)}`, 60, 15 * 60_000);
    if (!limit.ok) return json({ error: "Terlalu banyak permintaan. Coba lagi beberapa saat lagi." }, 429, { "Retry-After": String(limit.retryAfterSeconds) });

    const { id } = await ctx.params;
    assertUuid(id, "Lampiran");
    const ticketNumber = (new URL(request.url).searchParams.get("ticket") ?? "").trim().toUpperCase().replace(/\s+/g, "");
    if (!/^FB-\d{4}-\d{5,}$/.test(ticketNumber)) throw new NotFoundError("Lampiran tidak ditemukan.");

    const ticket = await getFeedbackTicketByNumber(ticketNumber);
    if (!ticket) throw new NotFoundError("Lampiran tidak ditemukan.");

    const attachment = await getFeedbackAttachment(id);
    if (!attachment || attachment.ticketId !== ticket.id) throw new NotFoundError("Lampiran tidak ditemukan.");

    const body = await storage().get(attachment.storagePath);
    if (!body) throw new NotFoundError("Lampiran tidak ditemukan di penyimpanan.");

    const wantsInline = new URL(request.url).searchParams.get("inline") === "1";
    const inline = wantsInline && INLINE_TYPES.has(attachment.mimeType);
    return new Response(body, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(attachment.fileSize),
        "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", attachment.fileName),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, "GET public feedback attachment");
  }
}
