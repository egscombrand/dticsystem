import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { createUser, listUsers } from "@/lib/server/repositories/users";
import { toFieldErrors } from "@/lib/validation/common";
import { userCreateSchema } from "@/lib/validation/users";

/** Daftar akun internal (Super Admin). Tidak pernah mengembalikan hash password. */
export async function GET(request: Request) {
  const auth = await authorize(request, "users.manage");
  if (!auth.ok) return auth.response;
  try {
    return json({ users: await listUsers() });
  } catch (error) {
    return errorResponse(error, "GET users");
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request, "users.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const parsed = userCreateSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali isian akun.", 422, toFieldErrors(parsed.error));
    const { password, fullName, email, role, memberId } = parsed.data;
    const id = await createUser({ fullName, email, role, memberId, password }, auth.session.userId);
    return json({ ok: true, id }, 201);
  } catch (error) {
    return errorResponse(error, "POST users");
  }
}
