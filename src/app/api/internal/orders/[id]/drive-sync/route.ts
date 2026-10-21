import { authorize, canAccessOrder } from "@/lib/server/auth";
import { assertSameOrigin, assertUuid, errorResponse, json } from "@/lib/server/http";
import { NotFoundError } from "@/lib/server/errors";
import { syncOrderDriveMetadata } from "@/lib/server/repositories/drive-sync";

/**
 * Sinkronkan metadata Google Drive -> aplikasi untuk SATU order (Fase 3/4). Tidak pernah mengunggah ulang
 * file atau membuat folder baru — hanya membaca metadata Drive dan memperbarui/menambah catatan yang
 * terbukti relasinya (fileId sudah tercatat, atau file ditemukan di folder kategori hasil order ini).
 * Dideduplikasi di repository (lihat syncOrderDriveMetadata) — body `{ "force": true }` memaksa lewati
 * jendela dedupe (dipakai tombol manual "Sinkronkan" eksplisit, bukan auto-sync saat halaman dibuka).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/drive-sync">) {
  const auth = await authorize(request, "orders.workflow");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    if (!(await canAccessOrder(auth.session, id))) throw new NotFoundError("Order tidak ditemukan.");
    const body = (await request.json().catch(() => ({}))) as { force?: boolean };
    const result = await syncOrderDriveMetadata(id, { force: body.force === true });
    return json(result);
  } catch (error) {
    return errorResponse(error, "POST orders/[id]/drive-sync");
  }
}
