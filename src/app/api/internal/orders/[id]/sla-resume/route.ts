import { authorize, canAccessOrder } from "@/lib/server/auth";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { resumeSlaOrder } from "@/lib/server/repositories/orders";

/**
 * "Lanjutkan Pekerjaan" — mengakui penutupan otomatis karena SLA tanpa mengubah status pekerjaan (status
 * pekerjaan TIDAK PERNAH terkunci oleh SLA, lihat resumeSlaOrder). Pelaku: PIC order ini, atau Super Admin.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/sla-resume">) {
  const auth = await authorize(request, "orders.status");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    const body = await readJson(request).catch(() => ({}));
    const note = typeof (body as { note?: unknown }).note === "string" ? ((body as { note: string }).note.slice(0, 1000) ?? null) : null;
    if (note && note.trim().length === 0) throw new AppError("Catatan tidak boleh hanya spasi.", 422, { note: "Catatan tidak boleh hanya spasi." });
    const s = auth.session;
    const result = await resumeSlaOrder(id, { userId: s.userId, role: s.role, memberId: s.memberId }, note);
    return json({ ok: true, resumed: result.resumed });
  } catch (error) {
    return errorResponse(error, "POST order sla-resume");
  }
}
