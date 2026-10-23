import { authorize } from "@/lib/server/auth";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { testFeedbackChannel } from "@/lib/server/services/feedback-notify";

/** Tes koneksi grup Tim IT (Super Admin). Mengirim pesan uji berlabel; tidak membuat tiket atau antrean. */
export async function POST(request: Request) {
  const auth = await authorize(request, "feedback.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const result = await testFeedbackChannel(auth.session.userId);
    return json(result, result.ok ? 200 : result.busy ? 429 : 422);
  } catch (error) {
    return errorResponse(error, "POST feedback-telegram test");
  }
}
