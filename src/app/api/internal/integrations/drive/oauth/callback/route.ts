import { authorize, cookieSecure } from "@/lib/server/auth";
import { exchangeCodeForTokens, fetchConnectedAccountEmail, OAUTH_STATE_COOKIE } from "@/lib/server/drive/oauth-client";
import { saveOAuthConnection } from "@/lib/server/repositories/drive-oauth";

const SETTINGS_PATH = "/dtic/settings/integrations/google-drive";

function redirectTo(request: Request, status: "connected" | "error", message?: string) {
  const url = new URL(SETTINGS_PATH, request.url);
  url.searchParams.set("oauth", status);
  if (message) url.searchParams.set("oauthMessage", message.slice(0, 200));
  const headers = new Headers({ Location: url.toString() });
  // Hapus cookie state sekali-pakai apa pun hasilnya.
  headers.append("Set-Cookie", `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecure() ? "; Secure" : ""}`);
  return new Response(null, { status: 302, headers });
}

/** Callback dari Google setelah pemilik akun menyetujui akses. Verifikasi `state` (CSRF) sebelum menukar code. */
export async function GET(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) return redirectTo(request, "error", `Google menolak: ${error}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieHeader = request.headers.get("cookie") ?? "";
  const expectedState = cookieHeader.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${OAUTH_STATE_COOKIE}=`))?.split("=")[1];

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectTo(request, "error", "Permintaan OAuth tidak valid (state tidak cocok atau kedaluwarsa). Coba hubungkan ulang.");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refreshToken) {
      return redirectTo(
        request,
        "error",
        "Google tidak mengirim refresh token. Cabut akses aplikasi ini di myaccount.google.com/permissions lalu coba hubungkan ulang.",
      );
    }
    const accountEmail = await fetchConnectedAccountEmail(tokens.accessToken);
    if (!accountEmail) return redirectTo(request, "error", "Tidak dapat membaca email akun Google yang terhubung.");

    await saveOAuthConnection({ accountEmail, refreshToken: tokens.refreshToken, scope: tokens.scope }, auth.session.userId);
    return redirectTo(request, "connected");
  } catch (err) {
    return redirectTo(request, "error", err instanceof Error ? err.message : "Gagal menghubungkan OAuth Google Drive.");
  }
}
