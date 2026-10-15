import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { authorize } from "@/lib/server/auth";
import { updateMasterRow } from "@/lib/server/repositories/master-data";
import { isMasterEntity, MASTER_SCHEMAS } from "@/lib/master-data";
import { toFieldErrors } from "@/lib/validation/common";

/** Ubah data master — khusus internal. Prioritas memakai kode sebagai id. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/internal/settings/[entity]/[id]">) {
  const auth = await authorize(request, "master.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { entity, id } = await ctx.params;
    if (!isMasterEntity(entity)) throw new AppError("Data tidak ditemukan.", 404);
    if (entity === "priorities") {
      if (!/^[a-z][a-z0-9_]{1,29}$/.test(id)) throw new AppError("Data tidak ditemukan.", 404);
    } else assertUuid(id);
    const parsed = MASTER_SCHEMAS[entity].safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali isian.", 422, toFieldErrors(parsed.error));
    await updateMasterRow(entity, id, parsed.data as never);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "PATCH settings");
  }
}
