import { UPLOAD_LIMITS } from "@/lib/config/app";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { deliverNewOrder } from "@/lib/server/services/telegram";
import { submitOrder } from "@/lib/server/services/submit-order";

const RATE_LIMIT = Number(process.env.SUBMIT_RATE_LIMIT_MAX ?? 5);
const RATE_WINDOW_MS = Number(process.env.SUBMIT_RATE_LIMIT_WINDOW_SECONDS ?? 600) * 1000;
const MAX_BODY = UPLOAD_LIMITS.maxTotalBytes + 1024 * 1024;

/** Endpoint PUBLIK satu-satunya: membuat order baru. Tidak bisa membaca/mengubah order lain. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);

    const limit = rateLimit(`submit:${clientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!limit.ok) {
      return json(
        { error: `Terlalu banyak pengajuan. Coba lagi dalam ${Math.ceil(limit.retryAfterSeconds / 60)} menit.` },
        429,
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }

    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_BODY) throw new AppError("Ukuran kiriman terlalu besar.", 413);
    if (!request.headers.get("content-type")?.includes("multipart/form-data"))
      throw new AppError("Format permintaan tidak valid.", 415);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError("Data formulir tidak dapat dibaca.", 400);
    }

    const result = await submitOrder(form);
    // Order sudah tersimpan (transaksi bersama antrean tujuan). Status notifikasi diambil dari hasil Telegram nyata:
    // 201/200 hanya bila terkirim (ok:true). Selainnya 202: tersimpan, notifikasi belum terkirim, dengan alasan.
    // Pengajuan ulang dengan kunci yang sama hanya menyelesaikan notifikasi; tidak membuat order baru.
    const delivery = await deliverNewOrder(result.id);
    if (delivery.state !== "sent") {
      const stage = delivery.state === "no_destination" ? "no_destination" : "notification_pending";
      const lead = stage === "no_destination"
        ? "Tidak ada tujuan Telegram yang aktif untuk brand ini, sehingga notifikasi belum terkirim."
        : "Notifikasi Telegram belum terkirim.";
      return json(
        {
          error: `Pengajuan tersimpan dengan nomor ${result.orderNumber}. ${lead} ${delivery.detail} Isian form dipertahankan; tekan "Kirim pengajuan" lagi untuk memeriksa ulang tanpa membuat pengajuan baru.`,
          stage,
          orderNumber: result.orderNumber,
        },
        202,
      );
    }
    return json(
      {
        orderNumber: result.orderNumber,
        createdAt: result.createdAt,
        deadlineAt: result.deadlineAt,
        brandName: result.brandName,
        designType: result.designType,
        duplicate: result.duplicate,
        attachmentCount: result.attachmentCount,
        notification: "sent",
      },
      result.duplicate ? 200 : 201,
    );
  } catch (error) {
    return errorResponse(error, "POST /api/public/orders");
  }
}
