import { authorize } from "@/lib/server/auth";
import { testDriveConnection } from "@/lib/server/drive";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { recordDriveTest } from "@/lib/server/repositories/drive-settings";

/** Uji koneksi nyata ke Google Drive A (baca metadata folder saja). Hanya Super Admin. */
export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const result = await testDriveConnection();
    const state = await recordDriveTest(result.ok, result.ok ? `Terhubung ke folder "${result.folderName}".` : result.message, auth.session.userId);
    return json({ ok: result.ok, message: result.ok ? `Terhubung ke folder "${result.folderName}".` : result.message, state });
  } catch (error) {
    return errorResponse(error, "POST integrations/drive/test");
  }
}
