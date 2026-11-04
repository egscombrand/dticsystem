import { authorize } from "@/lib/server/auth";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { runSlaSweep } from "@/lib/server/services/sla-worker";

/**
 * Jalankan sekarang satu putaran pemeriksaan SLA (Super Admin) — sama seperti satu tick worker latar
 * (lihat sla-worker.ts). Aman dipanggil berulang (idempotent, lihat closeOrderBySla).
 */
export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const closed = await runSlaSweep();
    return json({ ok: true, closed });
  } catch (error) {
    return errorResponse(error, "POST sla worker tick");
  }
}
