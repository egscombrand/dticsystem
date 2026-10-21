import "server-only";
import { DriveApiError } from "@/lib/drive";
import { fetchWithTimeout } from "@/lib/server/drive/client";

/**
 * OAuth 2.0 (authorization code, access_type=offline) atas nama akun Google pemilik folder
 * DTICSystemNexus — dipakai sebagai PENGGANTI service account untuk operasi yang memakan kuota
 * penyimpanan (unggah isi file), karena service account tidak punya kuota sendiri di luar Shared Drive.
 * Scope `drive` penuh (bukan `drive.file`) karena aplikasi harus mengelola folder yang SUDAH ADA dan
 * dibuat sebelum OAuth terhubung — `drive.file` hanya memberi akses ke file yang dibuat lewat aplikasi itu.
 */
export const OAUTH_STATE_COOKIE = "dtic_drive_oauth_state";
const OAUTH_SCOPE = "https://www.googleapis.com/auth/drive";
const AUTH_BASE = process.env.GOOGLE_OAUTH_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

function clientId(): string {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_OAUTH_CLIENT_ID belum diisi di environment server.");
  return id;
}
function clientSecret(): string {
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET belum diisi di environment server.");
  return secret;
}

export function oauthRedirectUri(): string {
  const appUrl = (process.env.DTIC_APP_URL ?? "").replace(/\/$/, "");
  if (!appUrl) throw new Error("DTIC_APP_URL belum diisi di environment server.");
  return `${appUrl}/api/internal/integrations/drive/oauth/callback`;
}

export function isOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY);
}

/** URL konsensus Google. `state` wajib nilai acak sekali-pakai (CSRF) yang diverifikasi di callback. */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: oauthRedirectUri(),
    response_type: "code",
    scope: OAUTH_SCOPE,
    access_type: "offline",
    prompt: "consent", // selalu minta refresh token baru, bukan hanya access token
    state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

export type OAuthTokens = { accessToken: string; refreshToken: string | null; expiresIn: number; scope: string };

/** Tukar authorization code (dari callback) menjadi access+refresh token. */
export async function exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: oauthRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    console.error(`[drive-oauth] exchangeCodeForTokens -> HTTP ${res.status}: ${bodyText.slice(0, 1000)}`);
    throw new DriveApiError(`Google menolak kode otorisasi (HTTP ${res.status}).`, "permanent", res.status);
  }
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope: string };
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null, expiresIn: data.expires_in, scope: data.scope };
}

/** Access token baru dari refresh token tersimpan. Dipanggil ulang setiap kali token proses kedaluwarsa. */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    console.error(`[drive-oauth] refreshAccessToken -> HTTP ${res.status}: ${bodyText.slice(0, 1000)}`);
    // 400 invalid_grant berarti refresh token sudah dicabut/kedaluwarsa — koneksi harus dihubungkan ulang.
    throw new DriveApiError(`Token OAuth Google Drive tidak valid lagi (HTTP ${res.status}). Hubungkan ulang.`, "permanent", res.status);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/** Cabut refresh token di sisi Google (saat admin memutuskan koneksi). Gagal mencabut tidak menggagalkan "putuskan koneksi" lokal. */
export async function revokeToken(refreshToken: string): Promise<void> {
  try {
    await fetchWithTimeout(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });
  } catch {
    // Tidak kritis — koneksi lokal tetap diputus (lihat drive-oauth.ts disconnectOAuth).
  }
}

/** Email akun yang terhubung, lewat Drive API sendiri (about.user) — tidak perlu scope userinfo tambahan. */
export async function fetchConnectedAccountEmail(accessToken: string): Promise<string | null> {
  const apiBase = process.env.GOOGLE_DRIVE_API_BASE || "https://www.googleapis.com/drive/v3";
  const res = await fetchWithTimeout(`${apiBase}/about?fields=user(emailAddress)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { user?: { emailAddress?: string } };
  return data.user?.emailAddress ?? null;
}
