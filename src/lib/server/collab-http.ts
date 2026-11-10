import "server-only";
import { NotFoundError } from "@/lib/server/errors";

const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

function contentDisposition(kind: "inline" | "attachment", fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Respons unduhan berkas kolaborasi: tipe aman, tidak di-cache, tanpa sniffing. */
export function fileResponse(file: { fileName: string; mimeType: string; fileSize: number; body: ReadableStream<Uint8Array> | null }, request: Request) {
  if (!file.body) throw new NotFoundError("Berkas tidak ditemukan di penyimpanan.");
  const inline = new URL(request.url).searchParams.get("inline") === "1" && INLINE_TYPES.has(file.mimeType);
  return new Response(file.body, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.fileSize),
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", file.fileName),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    const { AppError } = await import("@/lib/server/errors");
    throw new AppError("Format permintaan tidak valid.", 400);
  }
}
