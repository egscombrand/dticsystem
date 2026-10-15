import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { trackOrder } from "@/lib/server/services/tracking";

/** Pencarian riwayat publik: cukup nomor order. Tidak ada kode tambahan. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJson(request)) as { orderNumber?: unknown };
    if (typeof body.orderNumber !== "string" || body.orderNumber.length > 40)
      throw new AppError("Nomor order wajib diisi.", 422);
    return json(await trackOrder(request, body.orderNumber));
  } catch (error) {
    return errorResponse(error, "POST tracking");
  }
}
