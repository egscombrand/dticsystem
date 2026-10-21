import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { authorize } from "@/lib/server/auth";
import { changeOrderStatus, getOrderStatus, setOrderAssignees } from "@/lib/server/repositories/orders";
import { notifyOutbox } from "@/lib/server/services/telegram";
import { toFieldErrors } from "@/lib/validation/common";
import { assigneesSchema } from "@/lib/validation/order";

/**
 * Ubah daftar PIC — Super Admin dan Manager (orders.manage_pic), wajib alasan. Staff & pemohon ditolak.
 * Order lama berstatus "submitted" otomatis menjadi "assigned" setelah PIC pertama ditetapkan.
 * Status lain tidak berubah karena perubahan PIC.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/assignees">) {
  const auth = await authorize(request, "orders.manage_pic");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    const parsed = assigneesSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Daftar PIC tidak valid.", 422, toFieldErrors(parsed.error));
    const result = await setOrderAssignees(id, {
      memberIds: parsed.data.memberIds,
      reason: parsed.data.reason,
      expectedMemberIds: parsed.data.expectedMemberIds ?? null,
      actorUserId: auth.session.userId,
      actorName: auth.session.name,
      source: "pic_panel",
    });
    // Fire-and-forget (lihat catatan di src/app/api/internal/orders/[id]/route.ts): tidak memakai after()
    // Next.js — server Node.js persisten, dan after() di versi Next.js ini pernah terbukti membuat proses
    // berhenti merespons di bawah beban permintaan beruntun (lihat audit E2E).
    if (result.outboxId) void notifyOutbox(result.outboxId).catch(() => {});
    if (result.changed && (await getOrderStatus(id)) === "submitted") {
      const s = auth.session;
      const changed = await changeOrderStatus(id, "assigned", "PIC ditetapkan oleh Super Admin.", { userId: s.userId, role: s.role, memberId: s.memberId });
      if (changed.changed && changed.outboxId) void notifyOutbox(changed.outboxId).catch(() => {});
    }
    // Status penyimpanan PIC dan status notifikasi dilaporkan terpisah.
    return json({ ok: true, changed: result.changed, operation: result.operation, assignees: result.after, notification: result.notification });
  } catch (error) {
    return errorResponse(error, "PUT order assignees");
  }
}
