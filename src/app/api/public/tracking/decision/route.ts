import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { submitRequesterDecision } from "@/lib/server/services/tracking";

/**
 * Pemohon menyetujui atau meminta revisi hasil LANGSUNG dari Riwayat Request publik — mengacu pada SATU
 * pengajuan tertentu (deliveryId), diterapkan lewat aturan workflow yang SAMA dengan "Catat Masukan
 * Pemohon" internal (lihat submitRequesterDecision/checkWorkflowAction). Tidak ada sesi; nomor order tetap
 * satu-satunya identifier publik, konsisten dengan seluruh halaman Riwayat Request.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJson(request)) as { orderNumber?: unknown; deliveryId?: unknown; decision?: unknown; note?: unknown; requestKey?: unknown };
    if (typeof body.orderNumber !== "string" || body.orderNumber.length > 40) throw new AppError("Nomor order wajib diisi.", 422);
    if (typeof body.deliveryId !== "string") throw new AppError("Pengajuan tidak valid.", 422);
    if (body.decision !== "approved" && body.decision !== "revision") throw new AppError("Keputusan tidak valid.", 422);
    if (body.note !== undefined && typeof body.note !== "string") throw new AppError("Catatan tidak valid.", 422);
    if (body.requestKey !== undefined && typeof body.requestKey !== "string") throw new AppError("Permintaan tidak valid.", 422);
    return json(
      await submitRequesterDecision(request, {
        orderNumber: body.orderNumber,
        deliveryId: body.deliveryId,
        decision: body.decision,
        note: body.note,
        requestKey: body.requestKey,
      }),
    );
  } catch (error) {
    return errorResponse(error, "POST tracking decision");
  }
}
