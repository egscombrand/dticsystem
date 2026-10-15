import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { resetPassword } from "@/lib/server/repositories/users";
import { toFieldErrors } from "@/lib/validation/common";
import { passwordResetSchema } from "@/lib/validation/users";

/** Reset kata sandi oleh Super Admin. Semua sesi akun tersebut dicabut. */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/users/[id]/password">) {
  const auth = await authorize(request, "users.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Akun");
    const parsed = passwordResetSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Kata sandi tidak memenuhi syarat.", 422, toFieldErrors(parsed.error));
    await resetPassword(id, parsed.data.password, auth.session.userId);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "POST users password");
  }
}
