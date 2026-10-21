import { authorize, canAccessOrder } from "@/lib/server/auth";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { addResultLink } from "@/lib/server/repositories/results";
import { toFieldErrors } from "@/lib/validation/common";
import { resultLinkSchema } from "@/lib/validation/result-links";
import { isFinishedStatus, type OrderStatus } from "@/lib/status";

/**
 * Tambahkan SATU link hasil (website/repo/hosting) — pelengkap atau pengganti file untuk pekerjaan yang
 * hasilnya bukan dokumen (mis. website yang sudah online). Hak akses SAMA dengan unggah file hasil: hanya
 * PIC pekerjaan ini atau Super Admin, dan hanya selama pekerjaan belum selesai/dibatalkan.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/result-links">) {
  const auth = await authorize(request, "orders.workflow");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    const s = auth.session;
    if (!(await canAccessOrder(s, id))) throw new NotFoundError("Order tidak ditemukan.");
    const [o] = await sql()<{ status: OrderStatus; is_pic: boolean }[]>`
      select o.status, exists(select 1 from order_assignments a where a.order_id = o.id and a.member_id = ${s.memberId ?? null}) as is_pic
      from orders o where o.id = ${id}`;
    if (!o) throw new NotFoundError("Order tidak ditemukan.");
    if (!(s.role === "super_admin" || (s.role === "staff" && o.is_pic))) throw new AppError("Hanya PIC pekerjaan ini yang dapat menambah link hasil.", 403);
    if (isFinishedStatus(o.status)) throw new AppError("Pekerjaan sudah selesai atau dibatalkan.", 409);

    const parsed = resultLinkSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Link hasil tidak valid.", 422, toFieldErrors(parsed.error));
    const link = await addResultLink(id, parsed.data, s.userId);
    return json({ ok: true, link }, 201);
  } catch (error) {
    return errorResponse(error, "POST order result link");
  }
}
