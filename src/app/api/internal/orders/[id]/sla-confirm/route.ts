import { authorize, canAccessOrder } from "@/lib/server/auth";
import { NotFoundError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json } from "@/lib/server/http";
import { confirmSlaClosedComplete } from "@/lib/server/repositories/orders";

/**
 * "Konfirmasi Pekerjaan Selesai" — hanya untuk order yang SEDANG berstatus closed_sla (ditutup otomatis
 * karena SLA). Status berubah ke completed; riwayat closed_sla TETAP tersimpan (lihat confirmSlaClosedComplete,
 * insert-only, tidak pernah menghapus/menimpa). Pelaku: PIC order ini, atau Super Admin (diperiksa ulang di
 * confirmSlaClosedComplete, bukan hanya di sini — sama seperti endpoint status lain).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/sla-confirm">) {
  const auth = await authorize(request, "orders.status");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    const s = auth.session;
    const result = await confirmSlaClosedComplete(id, { userId: s.userId, role: s.role, memberId: s.memberId });
    return json({ ok: true, confirmed: result.confirmed });
  } catch (error) {
    return errorResponse(error, "POST order sla-confirm");
  }
}
