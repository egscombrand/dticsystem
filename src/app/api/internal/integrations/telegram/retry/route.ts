import { authorize } from "@/lib/server/auth";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { retryUnsentNotifications } from "@/lib/server/services/telegram";

export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    return json({ ok: true, ...(await retryUnsentNotifications()) });
  } catch (error) {
    return errorResponse(error, "POST integrations/telegram/retry");
  }
}
