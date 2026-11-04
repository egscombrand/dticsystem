import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { submitDeadlineDecision } from "@/lib/server/services/tracking";

/**
 * Pemohon menyetujui atau meminta penyesuaian waktu pengerjaan dari Riwayat Request publik (tanpa akun).
 * Alasan wajib untuk "Minta Penyesuaian". Lihat submitDeadlineDecision.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJson(request)) as { orderNumber?: unknown; decision?: unknown; reason?: unknown };
    if (typeof body.orderNumber !== "string" || body.orderNumber.length > 40) throw new AppError("Nomor order wajib diisi.", 422);
    if (body.decision !== "approve" && body.decision !== "adjust") throw new AppError("Keputusan tidak valid.", 422);
    if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 1000)) throw new AppError("Alasan tidak valid.", 422);
    return json(await submitDeadlineDecision(request, { orderNumber: body.orderNumber, decision: body.decision, reason: body.reason as string | undefined }));
  } catch (error) {
    return errorResponse(error, "POST tracking deadline");
  }
}
