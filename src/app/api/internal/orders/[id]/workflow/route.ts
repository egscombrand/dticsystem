import { authorize, canAccessOrder } from "@/lib/server/auth";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { applyWorkflowAction } from "@/lib/server/repositories/qc";
import { withTransientRetry } from "@/lib/server/db-diagnostics";
import { notifyOutbox } from "@/lib/server/services/telegram";
import { toFieldErrors } from "@/lib/validation/common";
import { workflowActionSchema } from "@/lib/validation/workflow";

/**
 * Aksi alur QC & komunikasi (ajukan QC, setujui, minta revisi, catat pengiriman/masukan, selesaikan).
 * Status baru TIDAK dipercaya dari klien: server menentukan hasil dari aksi + kebijakan QC pekerjaan
 * dan memeriksa pelaku (src/lib/qc.ts). Staff hanya pada order miliknya (404 untuk lainnya).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/workflow">) {
  const auth = await authorize(request, "orders.workflow");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    const parsed = workflowActionSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali isian.", 422, toFieldErrors(parsed.error));
    const s = auth.session;
    // Diulang sekali, hanya untuk error database yang murni sementara (lock/deadlock bentrok, koneksi
    // terputus) — mis. bentrok dengan migrasi yang sedang berjalan. Transaksi yang gagal sudah rollback
    // total; validasi, permission, dan aturan transisi TIDAK pernah membuat kode ini, jadi tidak diulang.
    const result = await withTransientRetry(() => applyWorkflowAction(id, parsed.data, { userId: s.userId, name: s.name, role: s.role, memberId: s.memberId }));
    // Fire-and-forget (lihat catatan di src/app/api/internal/orders/[id]/route.ts) — bukan after() Next.js.
    if (result.outboxId) void notifyOutbox(result.outboxId).catch(() => {});
    return json({ ok: true, changed: result.changed, duplicate: result.duplicate, status: result.status });
  } catch (error) {
    return errorResponse(error, "POST order workflow");
  }
}
