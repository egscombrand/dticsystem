import { z } from "zod";
import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { sendTestOrderMessage } from "@/lib/server/services/telegram";
import { toFieldErrors } from "@/lib/validation/common";

const bodySchema = z.object({ orderId: z.uuid({ error: "Order tidak valid." }) }).strict();

/** Pesan uji dari data satu order (diberi awalan "PESAN UJI"; tidak masuk antrean). */
export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Pilih order yang valid.", 422, toFieldErrors(parsed.error));
    assertUuid(parsed.data.orderId, "Order");
    const result = await sendTestOrderMessage(parsed.data.orderId, auth.session.userId);
    return json(result, result.ok ? 200 : 422);
  } catch (error) {
    return errorResponse(error, "POST integrations telegram test-order");
  }
}
