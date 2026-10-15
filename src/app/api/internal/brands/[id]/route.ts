import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { authorize } from "@/lib/server/auth";
import { updateMasterRow } from "@/lib/server/repositories/master-data";
import { MASTER_SCHEMAS } from "@/lib/master-data";
import { toFieldErrors } from "@/lib/validation/common";

/** Endpoint lama ubah brand (kompatibilitas) — kini memakai logika data master yang sama. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/internal/brands/[id]">) {
  const auth = await authorize(request, "master.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Brand");
    const parsed = MASTER_SCHEMAS.brands.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali isian brand.", 422, toFieldErrors(parsed.error));
    await updateMasterRow("brands", id, parsed.data);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "PATCH brand");
  }
}
