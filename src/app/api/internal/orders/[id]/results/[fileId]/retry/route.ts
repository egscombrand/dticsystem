import { authorize, canAccessOrder } from "@/lib/server/auth";
import { checkResultFileBasics, getExtension, resultContentMatches, sanitizeFileName } from "@/lib/files";
import { DriveNotConfiguredError } from "@/lib/server/drive";
import { resultMaxFileBytes } from "@/lib/server/config";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json } from "@/lib/server/http";
import { retryResultSync } from "@/lib/server/repositories/results";
import { isFinishedStatus, type OrderStatus } from "@/lib/status";

/**
 * Coba lagi sinkronisasi Drive untuk file yang berstatus 'pending' (terputus) atau 'failed'. Berkas yang
 * sama perlu dipilih ulang oleh pengguna (lihat catatan di repository) — permintaan ini menerima upload
 * baru, bukan menyimpan bytes dari percobaan pertama. Sama seperti unggah pertama: PIC order ini atau
 * Super Admin, pekerjaan belum selesai, tipe/ukuran/isi file divalidasi, dan idempoten lewat kunci baris.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/results/[fileId]/retry">) {
  const auth = await authorize(request, "orders.workflow");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id, fileId } = await ctx.params;
    assertUuid(id, "Order");
    assertUuid(fileId, "File");
    const s = auth.session;
    if (!(await canAccessOrder(s, id))) throw new NotFoundError("Order tidak ditemukan.");
    const [o] = await sql()<{ status: OrderStatus; is_pic: boolean }[]>`
      select o.status, exists(select 1 from order_assignments a where a.order_id = o.id and a.member_id = ${s.memberId ?? null}) as is_pic
      from orders o where o.id = ${id}`;
    if (!o) throw new NotFoundError("Order tidak ditemukan.");
    if (!(s.role === "super_admin" || (s.role === "staff" && o.is_pic))) throw new AppError("Hanya PIC pekerjaan ini yang dapat mengunggah hasil.", 403);
    if (isFinishedStatus(o.status)) throw new AppError("Pekerjaan sudah selesai atau dibatalkan.", 409);

    const max = resultMaxFileBytes();
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > max + 64 * 1024) throw new AppError(`File melebihi batas ${Math.round(max / 1024 / 1024)} MB.`, 413, { file: "File terlalu besar." });
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError("Unggahan tidak terbaca. Coba lagi.", 400);
    }
    const file = form.get("file");
    if (!file || typeof file === "string") throw new AppError("Pilih file hasil.", 422, { file: "Pilih file hasil." });
    const fileName = sanitizeFileName(file.name);
    const basic = checkResultFileBasics({ name: fileName, size: file.size }, max);
    if (basic) throw new AppError(basic, 422, { file: basic });
    const ext = getExtension(fileName);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!resultContentMatches(ext, bytes.subarray(0, 1024))) throw new AppError(`Isi file "${fileName}" tidak sesuai dengan formatnya.`, 422, { file: "Isi file tidak sesuai format." });

    const result = await retryResultSync(id, fileId, bytes);
    return json({ ok: true, ...result }, result.duplicate ? 200 : 201);
  } catch (error) {
    if (error instanceof DriveNotConfiguredError) {
      console.error("[results/retry] Drive tidak terkonfigurasi:", error.message);
      return json({ error: "Integrasi Google Drive belum dikonfigurasi. Hubungi Super Admin." }, 503);
    }
    return errorResponse(error, "POST order result retry");
  }
}
