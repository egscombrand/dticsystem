import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { updateUser } from "@/lib/server/repositories/users";
import { toFieldErrors } from "@/lib/validation/common";
import { userUpdateSchema } from "@/lib/validation/users";

export async function PATCH(request: Request, ctx: RouteContext<"/api/internal/users/[id]">) {
  const auth = await authorize(request, "users.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Akun");
    const parsed = userUpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali perubahan akun.", 422, toFieldErrors(parsed.error));
    await updateUser(id, parsed.data, auth.session.userId);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "PATCH users");
  }
}
