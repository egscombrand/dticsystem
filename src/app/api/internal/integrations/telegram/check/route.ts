import { authorize } from "@/lib/server/auth";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { checkBotToken } from "@/lib/server/services/telegram";

/** Periksa token bot (getMe, hanya baca). Hanya Super Admin. Tidak mengembalikan nilai token. */
export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    return json(await checkBotToken());
  } catch (error) {
    return errorResponse(error, "POST integrations/telegram/check");
  }
}
