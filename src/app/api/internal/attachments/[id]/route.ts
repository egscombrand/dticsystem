import { authorize, canAccessOrder } from "@/lib/server/auth";
import { NotFoundError } from "@/lib/server/errors";
import { assertUuid, errorResponse } from "@/lib/server/http";
import { getAttachment } from "@/lib/server/repositories/orders";
import { storage } from "@/lib/server/storage";

/** Tipe yang aman ditampilkan langsung di browser; lainnya selalu diunduh. */
const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

function contentDisposition(kind: "inline" | "attachment", fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Unduh/lihat dokumen — hanya untuk area internal. Berkas tidak pernah dibuka lewat URL publik. */
export async function GET(request: Request, ctx: RouteContext<"/api/internal/attachments/[id]">) {
  const auth = await authorize(request, "dashboard.view");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    assertUuid(id, "Dokumen");
    const attachment = await getAttachment(id);
    // Dokumen hanya bisa diunduh oleh yang berhak atas order-nya (Staff: order yang ditugaskan).
    if (!attachment || !(await canAccessOrder(auth.session, attachment.order_id)))
      throw new NotFoundError("Dokumen tidak ditemukan.");
    const body = await storage().get(attachment.storage_path);
    if (!body) throw new NotFoundError("Berkas dokumen tidak ditemukan di penyimpanan.");

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
    return errorResponse(error, "GET attachment");
  }
}
