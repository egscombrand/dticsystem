import { authorize } from "@/lib/server/auth";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { setDriveEnabled } from "@/lib/server/repositories/drive-settings";

/**
 * Nonaktifkan integrasi Drive untuk upload BARU. Tidak menyentuh file yang sudah tersimpan di Drive
 * (tetap bisa dilihat/diunduh lewat lampiran yang ada); upload berikutnya kembali memakai storage
 * lokal/Supabase seperti sebelum fitur ini ada.
 */
export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const state = await setDriveEnabled(false, auth.session.userId);
    return json({ ok: true, message: "Integrasi Google Drive dinonaktifkan. Upload hasil PIC berikutnya memakai penyimpanan lokal/Supabase.", state });
  } catch (error) {
    return errorResponse(error, "POST integrations/drive/disable");
  }
}
