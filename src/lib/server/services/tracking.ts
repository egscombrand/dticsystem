import "server-only";
import { AppError } from "@/lib/server/errors";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { findOrderForTracking, getPublicHistory, listPicNames } from "@/lib/server/repositories/orders";
import { isFinishedStatus, toCurrentStatus, type OrderStatus } from "@/lib/status";

/** Nomor order: DTIC-YYYY-NNNNN (sesuai format yang dibuat database). */
export const ORDER_NUMBER_RE = /^DTIC-\d{4}-\d{5,}$/;
export function normalizeOrderNumber(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

/** Batas pencarian per IP untuk mencegah enumerasi nomor order. */
const IP_LIMIT = 30;
const WINDOW_MS = 15 * 60_000;

export type TrackingView = {
  orderNumber: string;
  createdAt: string;
  deadlineAt: string;
  brandName: string;
  designType: string;
  status: OrderStatus;
  isClosed: boolean;
  requesterMessage: string | null;
  resultUrl: string | null;
  /** Nama PIC yang dipilih pemohon (nama saja; daftar ini memang tampil di form publik). */
  picNames: string[];
  /** Status riwayat dipetakan ke status baru (riwayat lama tetap utuh di database). */
  history: { status: OrderStatus; changedAt: string; note: string | null }[];
};

/**
 * Pencarian riwayat berdasarkan nomor order (identifier, bukan bukti kepemilikan).
 * Hanya kolom yang aman ditampilkan publik: TIDAK memuat brief, lampiran, kontak, atau catatan internal.
 */
export async function trackOrder(request: Request, rawOrderNumber: string): Promise<TrackingView> {
  const orderNumber = normalizeOrderNumber(rawOrderNumber);
  if (!ORDER_NUMBER_RE.test(orderNumber)) throw new AppError("Format nomor order tidak valid, contoh: DTIC-2026-00012.", 422);

  const ip = rateLimit(`track-ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
  if (!ip.ok) throw new AppError(`Terlalu banyak pencarian. Coba lagi dalam ${Math.ceil(ip.retryAfterSeconds / 60)} menit.`, 429);

  const order = await findOrderForTracking(orderNumber);
  if (!order) throw new AppError("Nomor order tidak ditemukan. Periksa kembali nomor yang Anda terima saat pengajuan.", 404);

  const [rawHistory, picNames] = await Promise.all([getPublicHistory(order.id), listPicNames(order.id)]);
  const history = rawHistory.flatMap((h) => {
    const status = toCurrentStatus(h.status);
    return status ? [{ ...h, status }] : [];
  });
  return {
    orderNumber: order.order_number,
    createdAt: order.created_at.toISOString(),
    deadlineAt: order.deadline_at.toISOString(),
    brandName: order.brand_name,
    designType: order.design_type,
    status: order.status,
    isClosed: isFinishedStatus(order.status),
    requesterMessage: order.requester_message,
    resultUrl: order.result_url,
    picNames,
    history,
  };
}
