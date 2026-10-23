import { authorize } from "@/lib/server/auth";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { processDueOutbox } from "@/lib/server/services/telegram";
import { processFeedbackNotifications } from "@/lib/server/services/feedback-notify";

/**
 * Proses sekarang notifikasi Telegram yang sudah jatuh tempo (Super Admin). Aman dipanggil berulang.
 * Memproses KEDUA antrean (order & tiket Bantuan & Masukan) — sama seperti satu tick worker latar
 * (lihat telegram-worker.ts), bukan dua jalur terpisah.
 */
export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const processed = await processDueOutbox(10);
    const processedFeedback = await processFeedbackNotifications(10);
    return json({ ok: true, processed, processedFeedback });
  } catch (error) {
    return errorResponse(error, "POST telegram worker tick");
  }
}
