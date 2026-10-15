import { authorize } from "@/lib/server/auth";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { processDueOutbox } from "@/lib/server/services/telegram";

/** Proses sekarang notifikasi Telegram yang sudah jatuh tempo (Super Admin). Aman dipanggil berulang. */
export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    return json({ ok: true, processed: await processDueOutbox(10) });
  } catch (error) {
    return errorResponse(error, "POST telegram worker tick");
  }
}
