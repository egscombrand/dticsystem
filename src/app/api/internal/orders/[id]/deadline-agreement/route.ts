import { authorize, canAccessOrder } from "@/lib/server/auth";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { getDeadlineAgreement, managerResolve, picAcceptRequested, picPropose } from "@/lib/server/repositories/deadline-agreement";

/**
 * Kesepakatan waktu pengerjaan (sisi internal). Kewenangan per aksi diperiksa di repository:
 *   accept_requested / propose — PIC order ini (atau Super Admin);
 *   resolve                    — Manager atau Super Admin (pengajuan yang belum sepakat, mis. eskalasi).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/deadline-agreement">) {
  const auth = await authorize(request, "dashboard.view");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    const view = await getDeadlineAgreement(id);
    if (!view) throw new NotFoundError("Order tidak ditemukan.");
    return json(view);
  } catch (error) {
    return errorResponse(error, "GET order deadline-agreement");
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/deadline-agreement">) {
  const auth = await authorize(request, "dashboard.view");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    const body = (await readJson(request)) as { action?: unknown; deadlineAt?: unknown; reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason : null;
    const s = auth.session;
    const actor = { userId: s.userId, name: s.name, role: s.role, memberId: s.memberId };
    const deadline = () => {
      if (typeof body.deadlineAt !== "string") throw new AppError("Deadline wajib diisi.", 422, { deadlineAt: "Deadline wajib diisi." });
      return new Date(body.deadlineAt);
    };
    switch (body.action) {
      case "accept_requested":
        return json(await picAcceptRequested(id, actor));
      case "propose":
        return json(await picPropose(id, actor, deadline(), reason));
      case "resolve":
        return json(await managerResolve(id, actor, deadline(), reason));
      case "approve":
      case "adjust":
        // Menyetujui/meminta penyesuaian adalah hak Pemohon (lewat Riwayat Request publik), bukan akun internal.
        throw new AppError("Persetujuan waktu hanya dapat diberikan Pemohon melalui halaman Riwayat Request.", 403);
      default:
        throw new AppError("Aksi tidak dikenal.", 422);
    }
  } catch (error) {
    return errorResponse(error, "POST order deadline-agreement");
  }
}
