import { can } from "@/lib/auth/permissions";
import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { deleteOrder, updateOrder } from "@/lib/server/repositories/orders";
import { notifyOutbox } from "@/lib/server/services/telegram";
import { storage } from "@/lib/server/storage";
import { toFieldErrors } from "@/lib/validation/common";
import { orderUpdateSchema } from "@/lib/validation/order";

export async function PATCH(request: Request, ctx: RouteContext<"/api/internal/orders/[id]">) {
  const auth = await authorize(request, "orders.update");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    const parsed = orderUpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali isian.", 422, toFieldErrors(parsed.error));
    // Edit detail tidak boleh menjadi jalan pintas penugasan: PIC hanya oleh role dengan orders.manage_pic.
    if (parsed.data.assigneeIds !== undefined && !can(auth.session.role, "orders.manage_pic")) {
      throw new AppError("Anda tidak memiliki izin untuk menetapkan PIC.", 403);
    }
    const { picOutboxId } = await updateOrder(id, parsed.data, { userId: auth.session.userId, name: auth.session.name });
    // Fire-and-forget: proses tanpa menunggu & tidak pernah menggagalkan respons ini (notifyOutbox sudah
    // menangkap errornya sendiri). Server Node.js persisten (bukan serverless) — tidak perlu after()/waitUntil
    // Next.js untuk memastikan tugas ini selesai; after() di versi Next.js proyek ini pernah terbukti membuat
    // proses server berhenti merespons di bawah beban permintaan beruntun (lihat audit E2E).
    if (picOutboxId) void notifyOutbox(picOutboxId).catch(() => {});
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "PATCH order");
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/internal/orders/[id]">) {
  const auth = await authorize(request, "orders.delete");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    const paths = await deleteOrder(id, auth.session.userId);
    if (paths.length > 0) {
      // Data order sudah terhapus; kegagalan bersih-bersih berkas hanya dicatat.
      await storage()
        .remove(paths)
        .catch((e) => console.error("[DELETE order] storage cleanup", e));
    }
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "DELETE order");
  }
}
