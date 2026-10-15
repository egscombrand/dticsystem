import { authorize } from "@/lib/server/auth";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { assertUuid, json } from "@/lib/server/http";
import { previewOrderMessage } from "@/lib/server/services/telegram";
import { telegramHtmlToText } from "@/lib/telegram";

/**
 * Pratinjau pesan Telegram untuk order (Super Admin). Hanya membaca data: tidak membuat order,
 * tidak mengubah status, dan tidak mengirim pesan.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/telegram/preview">) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    const test = new URL(request.url).searchParams.get("test") === "1";
    const preview = await previewOrderMessage(id, test);
    if (!preview) throw new NotFoundError("Order tidak ditemukan.");
    return json({ text: telegramHtmlToText(preview.text), tokenConfigured: preview.tokenConfigured, tokenProblem: preview.tokenProblem, destination: preview.destination, test });
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    // Pratinjau bukan operasi simpan: jangan pakai pesan "Data tidak tersimpan". Catat jenis galat saja (tanpa data).
    console.error("[GET order telegram preview]", error instanceof Error ? `${error.name}: ${error.message}` : "unknown");
    return json({ error: "Pratinjau gagal dimuat. Silakan coba lagi." }, 500);
  }
}
