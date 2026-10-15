import { authorize } from "@/lib/server/auth";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { parseBrandTarget } from "@/lib/server/repositories/telegram-brands";
import { testBrandChannel } from "@/lib/server/services/telegram";

/** Tes koneksi grup satu brand (Super Admin). Mengirim pesan uji berlabel; tidak membuat order atau antrean. */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/telegram-brands/[brandId]/test">) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { brandId } = await ctx.params;
    const result = await testBrandChannel(parseBrandTarget(brandId), auth.session.userId);
    return json(result, result.ok ? 200 : result.busy ? 429 : 422);
  } catch (error) {
    return errorResponse(error, "POST telegram-brands test");
  }
}
