import { clearedSessionCookieHeader, revokeSessionToken, tokenFromRequest } from "@/lib/server/auth";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";

/** Mengakhiri sesi di server (dicabut di database) dan menghapus cookie di browser. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    await revokeSessionToken(tokenFromRequest(request));
    const response = json({ ok: true });
    response.headers.append("Set-Cookie", clearedSessionCookieHeader());
    return response;
  } catch (error) {
    return errorResponse(error, "POST auth/logout");
  }
}
