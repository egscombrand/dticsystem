import { authorize, canAccessOrder } from "@/lib/server/auth";
import { checkResultFileBasics, getExtension, RESULT_FILE_TYPES, resultContentMatches, sanitizeFileName } from "@/lib/files";
import { resultMaxFileBytes } from "@/lib/server/config";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, UUID_RE } from "@/lib/server/http";
import { saveResultFile } from "@/lib/server/repositories/results";
import { StorageNotConfiguredError } from "@/lib/server/storage";
import { isFinishedStatus, type OrderStatus } from "@/lib/status";

/**
 * Unggah SATU file hasil pekerjaan (multipart: file, uploadKey). Hanya PIC pekerjaan ini atau Super Admin,
 * dan hanya selama pekerjaan belum selesai. Tipe, ukuran, dan isi file diperiksa di server.
 * File baru berstatus draf; baru terhubung ke QC/pengiriman/penyelesaian saat PIC mengonfirmasi aksinya.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/results">) {
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
    const uploadKey = form.get("uploadKey");
    const file = form.get("file");
    if (typeof uploadKey !== "string" || !UUID_RE.test(uploadKey)) throw new AppError("Kunci unggahan tidak valid.", 422);
    if (!file || typeof file === "string") throw new AppError("Pilih file hasil.", 422, { file: "Pilih file hasil." });
    const fileName = sanitizeFileName(file.name);
    const basic = checkResultFileBasics({ name: fileName, size: file.size }, max);
    if (basic) throw new AppError(basic, 422, { file: basic });
    const ext = getExtension(fileName);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!resultContentMatches(ext, bytes.subarray(0, 1024))) throw new AppError(`Isi file "${fileName}" tidak sesuai dengan formatnya.`, 422, { file: "Isi file tidak sesuai format." });

    const result = await saveResultFile(id, { uploadKey, fileName, ext, mimeType: RESULT_FILE_TYPES[ext], bytes }, s.userId);
    return json({ ok: true, ...result }, result.duplicate ? 200 : 201);
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      console.error("[results] storage tidak terkonfigurasi:", error.message);
      return json({ error: "Penyimpanan file belum dikonfigurasi. Hubungi Super Admin." }, 503);
    }
    return errorResponse(error, "POST order result file");
  }
}
