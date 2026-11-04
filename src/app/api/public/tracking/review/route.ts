import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { publicReviewAction, publicReviewRead } from "@/lib/server/services/review";

/**
 * Review Center untuk Pemohon (tanpa akun) — nomor order adalah satu-satunya identifier publik, konsisten dengan
 * seluruh Riwayat Request. Semua data dibatasi pada order itu; versi yang bisa direview hanya hasil yang BENAR-BENAR
 * sudah diserahkan kepada pemohon. Tidak ada PUT/PATCH/DELETE: riwayat hanya bertambah (405).
 */
export async function GET(request: Request) {
  try {
    const order = new URL(request.url).searchParams.get("order") ?? "";
    return json(await publicReviewRead(request, order));
  } catch (error) {
    return errorResponse(error, "GET public review");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJson(request)) as Record<string, unknown>;
    if (!body || typeof body !== "object") throw new AppError("Format permintaan tidak valid.", 400);
    return json(await publicReviewAction(request, body));
  } catch (error) {
    return errorResponse(error, "POST public review");
  }
}
