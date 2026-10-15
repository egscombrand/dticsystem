import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { authorize } from "@/lib/server/auth";
import { createMasterRow } from "@/lib/server/repositories/master-data";
import { isMasterEntity, MASTER_SCHEMAS } from "@/lib/master-data";
import { toFieldErrors } from "@/lib/validation/common";

/** Tambah data master (brand, divisi, member, jenis order, prioritas) — khusus internal. */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/settings/[entity]">) {
  const auth = await authorize(request, "master.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { entity } = await ctx.params;
    if (!isMasterEntity(entity)) throw new AppError("Data tidak ditemukan.", 404);
    const parsed = MASTER_SCHEMAS[entity].safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali isian.", 422, toFieldErrors(parsed.error));
    const id = await createMasterRow(entity, parsed.data as never);
    return json({ ok: true, id }, 201);
  } catch (error) {
    return errorResponse(error, "POST settings");
  }
}
