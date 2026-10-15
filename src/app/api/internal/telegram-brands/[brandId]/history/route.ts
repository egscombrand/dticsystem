import { authorize } from "@/lib/server/auth";
import { errorResponse, json } from "@/lib/server/http";
import { brandHistory, parseBrandTarget } from "@/lib/server/repositories/telegram-brands";

/** Riwayat pengiriman satu brand (Super Admin). */
export async function GET(request: Request, ctx: RouteContext<"/api/internal/telegram-brands/[brandId]/history">) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    const { brandId } = await ctx.params;
    return json({ rows: await brandHistory(parseBrandTarget(brandId)) });
  } catch (error) {
    return errorResponse(error, "GET telegram-brands history");
  }
}
