import { z } from "zod";
import { authorize, canAccessOrder } from "@/lib/server/auth";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { logWhatsappOpened } from "@/lib/server/repositories/qc";
import { WA_TEMPLATE_LABEL, WA_TEMPLATES } from "@/lib/smart-whatsapp";

const schema = z.strictObject({
  template: z.enum(WA_TEMPLATES).nullable(),
  edited: z.boolean(),
  requestKey: z.uuid(),
});

/**
 * Catat "WhatsApp dibuka" untuk riwayat & penentuan perkenalan. Tidak mengubah status dan tidak menyatakan
 * pesan terkirim. Siapa pun yang berhak membuka order ini (PIC, Manager, Super Admin).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/whatsapp-log">) {
  const auth = await authorize(request, "orders.workflow");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Data tidak valid.", 422);
    const t = parsed.data.template;
    await logWhatsappOpened(id, { template: t ?? "custom", templateLabel: t ? WA_TEMPLATE_LABEL[t] : "Pesan bebas", edited: parsed.data.edited, requestKey: parsed.data.requestKey }, { userId: auth.session.userId, name: auth.session.name });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "POST order whatsapp-log");
  }
}
