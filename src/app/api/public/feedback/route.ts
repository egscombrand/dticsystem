import { UPLOAD_LIMITS } from "@/lib/config/app";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { submitFeedbackTicket } from "@/lib/server/services/feedback";

const RATE_LIMIT = Number(process.env.FEEDBACK_RATE_LIMIT_MAX ?? 5);
const RATE_WINDOW_MS = Number(process.env.FEEDBACK_RATE_LIMIT_WINDOW_SECONDS ?? 600) * 1000;
const MAX_BODY = UPLOAD_LIMITS.maxTotalBytes + 1024 * 1024;

/** Endpoint PUBLIK: buat tiket Bantuan & Masukan. Terbuka untuk tamu maupun pengguna internal yang login. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);

    const limit = rateLimit(`feedback-submit:${clientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!limit.ok) {
      return json(
        { error: `Terlalu banyak laporan. Coba lagi dalam ${Math.ceil(limit.retryAfterSeconds / 60)} menit.` },
        429,
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }

    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_BODY) throw new AppError("Ukuran kiriman terlalu besar.", 413);
    if (!request.headers.get("content-type")?.includes("multipart/form-data")) throw new AppError("Format permintaan tidak valid.", 415);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError("Data formulir tidak dapat dibaca.", 400);
    }

    // Tiket tersimpan DULU (termasuk baris antrean notifikasi, satu transaksi — lihat insertFeedbackTicket);
    // notifikasi Telegram dijadwalkan dan dikirim oleh worker Telegram yang sudah ada (tick setiap beberapa
    // detik — lihat processFeedbackNotifications di telegram-worker.ts), bukan dikirim langsung di sini.
    // Kegagalan Telegram TIDAK PERNAH membatalkan tiket yang sudah tersimpan.
    const result = await submitFeedbackTicket(request, form);
    return json({ ticketNumber: result.ticketNumber }, 201);
  } catch (error) {
    return errorResponse(error, "POST /api/public/feedback");
  }
}
