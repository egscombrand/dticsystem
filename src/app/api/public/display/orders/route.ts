import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { errorResponse, json } from "@/lib/server/http";
import { displaySnapshot } from "@/lib/server/repositories/display";

/**
 * Data layar display PUBLIK (polling, tanpa login — layar TV kantor/ruang tunggu). Cakupan TIDAK dibatasi
 * per staf (tidak ada sesi untuk dibatasi): seluruh order aktif, sama seperti pandangan Super Admin di
 * /api/internal/display/orders (endpoint lama, tetap ada untuk pemakaian berbasis sesi bila diperlukan
 * nanti). Respons minimal; tanpa WhatsApp, brief, atau catatan internal — lihat displaySnapshot.
 */
export async function GET(request: Request) {
  const limit = rateLimit(`display:${clientIp(request)}`, 120, 10 * 60 * 1000);
  if (!limit.ok) return json({ error: "Terlalu banyak permintaan." }, 429, { "Retry-After": String(limit.retryAfterSeconds) });
  try {
    return json(await displaySnapshot(undefined, new Date()));
  } catch (error) {
    return errorResponse(error, "GET public display orders");
  }
}
