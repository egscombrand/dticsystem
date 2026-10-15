import { authorize, orderScopeFor } from "@/lib/server/auth";
import { errorResponse, json } from "@/lib/server/http";
import { displaySnapshot } from "@/lib/server/repositories/display";

/**
 * Data layar display (polling). Izin: dashboard.view (sesi login). Cakupan mengikuti role: Staff hanya
 * melihat order yang ditugaskan kepadanya. Respons minimal; tanpa WhatsApp, brief, atau catatan internal.
 */
export async function GET(request: Request) {
  const auth = await authorize(request, "dashboard.view");
  if (!auth.ok) return auth.response;
  try {
    return json(await displaySnapshot(orderScopeFor(auth.session), new Date()));
  } catch (error) {
    return errorResponse(error, "GET display orders");
  }
}
