import { authorize, canAccessOrder } from "@/lib/server/auth";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { changeOrderStatus } from "@/lib/server/repositories/orders";
import { notifyOutbox } from "@/lib/server/services/telegram";
import { toFieldErrors } from "@/lib/validation/common";
import { statusChangeSchema } from "@/lib/validation/order";

/**
 * Ubah status order. Status baru dari klien TIDAK dipercaya: aturan transisi, pelaku (PIC /
 * Super Admin), dan alasan wajib diperiksa di server (changeOrderStatus → src/lib/workflow.ts).
 * Manager tidak memiliki orders.status (403). Staff hanya melihat order miliknya (404 untuk lainnya).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/status">) {
  const auth = await authorize(request, "orders.status");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    const parsed = statusChangeSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Status tidak valid.", 422, toFieldErrors(parsed.error));
    const s = auth.session;
    const result = await changeOrderStatus(id, parsed.data.status, parsed.data.note, { userId: s.userId, role: s.role, memberId: s.memberId }, parsed.data.noteForClient === true);
    // Fire-and-forget (lihat catatan di src/app/api/internal/orders/[id]/route.ts) — bukan after() Next.js.
    if (result.changed && result.outboxId) void notifyOutbox(result.outboxId).catch(() => {});
    return json({ ok: true, changed: result.changed });
  } catch (error) {
    return errorResponse(error, "POST order status");
  }
}
