import { authorize } from "@/lib/server/auth";
import { revokeToken } from "@/lib/server/drive/oauth-client";
import { disconnectOAuth } from "@/lib/server/repositories/drive-oauth";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";

/** Putuskan koneksi OAuth. Operasi metadata/upload berikutnya jatuh kembali ke service account (lihat drive/index.ts). */
export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const oldRefreshToken = await disconnectOAuth(auth.session.userId);
    if (oldRefreshToken) await revokeToken(oldRefreshToken);
    return json({ ok: true, message: "Koneksi OAuth Google Drive diputus. Upload berikutnya jatuh kembali ke service account (hanya folder, bukan isi file)." });
  } catch (error) {
    return errorResponse(error, "POST integrations/drive/oauth/disconnect");
  }
}
