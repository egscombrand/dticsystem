import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { updateMenuItem } from "@/lib/server/repositories/menu";
import { toFieldErrors } from "@/lib/validation/common";
import { menuPatchSchema } from "@/lib/validation/menu";

const KEY_RE = /^[a-z][a-z0-9_-]{1,40}$/;

export async function PATCH(request: Request, ctx: RouteContext<"/api/internal/menu/[key]">) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { key } = await ctx.params;
    if (!KEY_RE.test(key)) throw new AppError("Menu tidak ditemukan.", 404);
    const parsed = menuPatchSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali perubahan menu.", 422, toFieldErrors(parsed.error));
    await updateMenuItem(key, parsed.data, auth.session.userId);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "PATCH menu");
  }
}
