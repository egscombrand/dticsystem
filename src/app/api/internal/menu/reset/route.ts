import { authorize } from "@/lib/server/auth";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { resetMenuItems } from "@/lib/server/repositories/menu";

export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    await resetMenuItems(auth.session.userId);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "POST menu reset");
  }
}
