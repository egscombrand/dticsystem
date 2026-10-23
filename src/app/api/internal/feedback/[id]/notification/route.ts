import { authorize } from "@/lib/server/auth";
import { assertSameOrigin, assertUuid, errorResponse, json } from "@/lib/server/http";
import { getFeedbackNotificationStatus, listFeedbackNotificationAttempts } from "@/lib/server/repositories/feedback-telegram";
import { sendFeedbackNotificationManually } from "@/lib/server/services/feedback-notify";

/** Status & riwayat notifikasi Telegram untuk satu tiket (Super Admin). Tidak ditampilkan ke pengguna biasa. */
export async function GET(request: Request, ctx: RouteContext<"/api/internal/feedback/[id]/notification">) {
  const auth = await authorize(request, "feedback.manage");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    assertUuid(id, "Tiket");
    const [status, attempts] = await Promise.all([getFeedbackNotificationStatus(id), listFeedbackNotificationAttempts(id)]);
    return json({ status, attempts });
  } catch (error) {
    return errorResponse(error, "GET feedback/[id]/notification");
  }
}

/**
 * Tombol "Kirim ke Telegram" (Super Admin) — kirim atau kirim ulang SEKARANG, bukan menunggu tick berikutnya.
 * Hasil respons adalah status Telegram SEBENARNYA (lihat sendFeedbackNotificationManually); tidak pernah
 * menandai berhasil hanya karena permintaan ini diterima. Tidak pernah membuat tiket baru atau mengubah
 * status tindak lanjut tiket.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/feedback/[id]/notification">) {
  const auth = await authorize(request, "feedback.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Tiket");
    const result = await sendFeedbackNotificationManually(id, { userId: auth.session.userId, name: auth.session.name });
    return json(result, result.ok ? 200 : 422);
  } catch (error) {
    return errorResponse(error, "POST feedback/[id]/notification");
  }
}
