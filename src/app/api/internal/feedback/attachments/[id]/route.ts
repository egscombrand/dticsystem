import { authorize } from "@/lib/server/auth";
import { NotFoundError } from "@/lib/server/errors";
import { assertUuid, errorResponse } from "@/lib/server/http";
import { getFeedbackAttachment } from "@/lib/server/repositories/feedback";
import { storage } from "@/lib/server/storage";

const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

function contentDisposition(kind: "inline" | "attachment", fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Unduh/lihat lampiran tiket — hanya Super Admin (feedback.manage). */
export async function GET(request: Request, ctx: RouteContext<"/api/internal/feedback/attachments/[id]">) {
  const auth = await authorize(request, "feedback.manage");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    assertUuid(id, "Lampiran");
    const attachment = await getFeedbackAttachment(id);
    if (!attachment) throw new NotFoundError("Lampiran tidak ditemukan.");
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
    return errorResponse(error, "GET internal feedback attachment");
  }
}
