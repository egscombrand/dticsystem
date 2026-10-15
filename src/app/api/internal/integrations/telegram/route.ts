import { authorize } from "@/lib/server/auth";
import { errorResponse, json } from "@/lib/server/http";
import { getIntegrationStatus } from "@/lib/server/services/telegram";

/** Status integrasi Telegram untuk Super Admin. Tidak pernah memuat nilai token atau chat ID. */
export async function GET(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    return json(await getIntegrationStatus());
  } catch (error) {
    return errorResponse(error, "GET integrations/telegram");
  }
}
