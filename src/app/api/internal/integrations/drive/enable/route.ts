import { authorize } from "@/lib/server/auth";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { setDriveEnabled } from "@/lib/server/repositories/drive-settings";

/**
 * Aktifkan integrasi Drive untuk upload BARU. Menolak bila prasyarat belum terpenuhi (konfigurasi tidak
 * valid, tabel pengaturan belum ada, atau uji koneksi terakhir belum berhasil) — lihat setDriveEnabled.
 * Tidak pernah memulai upload maupun mengubah status order/QC/pengiriman.
 */
export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const state = await setDriveEnabled(true, auth.session.userId);
    return json({ ok: true, message: "Integrasi Google Drive diaktifkan. Upload hasil PIC berikutnya memakai Drive A.", state });
  } catch (error) {
    return errorResponse(error, "POST integrations/drive/enable");
  }
}
