import { STATUS_META } from "@/lib/status";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { json, UUID_RE } from "@/lib/server/http";
import { findOrderBySubmissionKey } from "@/lib/server/repositories/orders";

/**
 * Rekonsiliasi pengajuan: pemohon memeriksa apakah pengajuan dengan kunci yang sama sudah tersimpan
 * (mis. setelah koneksi terputus). Kunci acak 128-bit hanya ada di browser pemohon. Hanya data
 * yang sudah ditampilkan kepada pemohon yang dikembalikan; tidak ada id internal atau data pribadi lain.
 */
export async function GET(request: Request) {
  const limit = rateLimit(`status:${clientIp(request)}`, 60, 10 * 60 * 1000);
  if (!limit.ok) return json({ error: "Terlalu sering memeriksa status. Coba lagi sebentar." }, 429, { "Retry-After": String(limit.retryAfterSeconds) });
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!UUID_RE.test(key)) return json({ error: "Kunci pengajuan tidak valid." }, 400);
  const r = await findOrderBySubmissionKey(key);
  if (!r) return json({ found: false }, 404);
  return json({
    found: true,
    orderNumber: r.orderNumber,
    title: r.title,
    status: r.status,
    statusLabel: STATUS_META[r.status].label,
    createdAt: r.createdAt,
    deadlineAt: r.deadlineAt,
    brandName: r.brandName,
    designType: r.designType,
    attachmentCount: r.attachmentCount,
  });
}
