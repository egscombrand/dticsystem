import { randomBytes } from "node:crypto";
import { authorize, cookieSecure } from "@/lib/server/auth";
import { buildAuthUrl, isOAuthConfigured, OAUTH_STATE_COOKIE } from "@/lib/server/drive/oauth-client";
import { errorResponse } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";

/**
 * Mulai alur OAuth 2.0 (navigasi browser biasa, BUKAN fetch — makanya tidak memakai assertSameOrigin/
 * X-DTIC-Request seperti endpoint admin lain; perlindungan CSRF di sini memakai parameter `state` sekali
 * pakai yang disimpan di cookie httpOnly singkat, diverifikasi lagi di /oauth/callback).
 */
export async function GET(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    if (!isOAuthConfigured()) {
      throw new AppError("OAuth Google Drive belum dikonfigurasi di environment server (GOOGLE_OAUTH_CLIENT_ID/SECRET/GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY).", 422);
    }
    const state = randomBytes(24).toString("base64url");
    const url = buildAuthUrl(state);
    const headers = new Headers({ Location: url });
    headers.append(
      "Set-Cookie",
      `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${cookieSecure() ? "; Secure" : ""}`,
    );
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return errorResponse(error, "GET integrations/drive/oauth/connect");
  }
}
