import { authorize } from "@/lib/server/auth";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { sendTestNotification } from "@/lib/server/services/telegram";

export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const result = await sendTestNotification();
    return json(result.ok ? { ok: true, message: "Pesan uji terkirim ke chat tujuan." } : { ok: false, message: result.message });
  } catch (error) {
    return errorResponse(error, "POST integrations/telegram/test");
  }
}
