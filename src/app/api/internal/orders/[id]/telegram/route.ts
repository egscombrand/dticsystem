import { z } from "zod";
import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { resendOrderNow } from "@/lib/server/services/telegram";
import { toFieldErrors } from "@/lib/validation/common";

const bodySchema = z.object({ key: z.uuid({ error: "Permintaan tidak valid. Muat ulang halaman." }) }).strict();

/** Kirim ulang notifikasi Telegram untuk satu order (Super Admin). Tidak mengubah data order. */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/telegram">) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Permintaan tidak valid.", 422, toFieldErrors(parsed.error));
    const result = await resendOrderNow(id, parsed.data.key, auth.session.userId);
    return json(result, result.ok ? 200 : 422);
  } catch (error) {
    return errorResponse(error, "POST order telegram");
  }
}
