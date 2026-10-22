import "server-only";
import { AppError } from "@/lib/server/errors";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { findOrderForTracking, getPublicDeliveries, getPublicHistory, getPublicQcEvents, isPublicDeliveryEvent, listPicNames, type PublicDelivery } from "@/lib/server/repositories/orders";
import { applyWorkflowAction } from "@/lib/server/repositories/qc";
import { awaitingPicClosure, hasSubmittedToRequester } from "@/lib/result-status";
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
  /** Pemohon sudah menyetujui hasil (QC selesai) tapi PIC belum menutup pekerjaan — lihat
   *  awaitingPicClosure di src/lib/result-status.ts. Beda dari `status` karena persetujuan pemohon TIDAK
   *  mengubah status order (lihat applyWorkflowAction) — murni diturunkan dari riwayat masukan pemohon. */
  awaitingClosure: boolean;
  /** true HANYA selama Manager sudah ACC tapi hasil BELUM benar-benar diajukan ke pemohon — lihat
   *  hasSubmittedToRequester di src/lib/result-status.ts. Selama ini true, frontend TIDAK BOLEH
   *  menampilkan "Menunggu Masukan Anda" (status itu berarti pemohon punya sesuatu untuk diperiksa). */
  awaitingSubmissionToRequester: boolean;
  /** Hasil yang BENAR-BENAR sudah diajukan ke pemohon (delivery_recorded) — urut waktu, satu entri per
   *  pengajuan/versi. Draf internal PIC yang belum diajukan TIDAK PERNAH muncul di sini. */
  deliveries: PublicDelivery[];
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

  const [rawHistory, picNames, qcEvents, deliveries] = await Promise.all([
    getPublicHistory(order.id),
    listPicNames(order.id),
    getPublicQcEvents(order.id),
    getPublicDeliveries(order.id),
  ]);
  const history = rawHistory.flatMap((h) => {
    const status = toCurrentStatus(h.status);
    return status ? [{ ...h, status }] : [];
  });
  const closed = isFinishedStatus(order.status);
  const submitted = hasSubmittedToRequester(qcEvents);
  return {
    orderNumber: order.order_number,
    createdAt: order.created_at.toISOString(),
    deadlineAt: order.deadline_at.toISOString(),
    brandName: order.brand_name,
    designType: order.design_type,
    status: order.status,
    isClosed: closed,
    requesterMessage: order.requester_message,
    resultUrl: order.result_url,
    picNames,
    history,
    awaitingClosure: awaitingPicClosure(qcEvents, closed),
    // ACC Manager sudah memindahkan order.status ke 'awaiting_requester' (lihat applyWorkflowAction), tapi
    // itu TIDAK membuktikan pemohon sudah menerima apa pun untuk diperiksa.
    awaitingSubmissionToRequester: !closed && order.status === "awaiting_requester" && order.qc_status === "approved" && !submitted,
    deliveries,
  };
}

/** Mutasi lebih ketat daripada pencarian read-only (track-ip) — keputusan pemohon berdampak nyata ke status pekerjaan. */
const DECIDE_IP_LIMIT = 20;

/**
 * Pemohon menyetujui atau meminta revisi LANGSUNG dari Riwayat Request publik (tanpa akun) — mengacu pada
 * SATU pengajuan tertentu (`deliveryId`, bukan asumsi "yang terakhir"). Menerapkan aturan yang SAMA persis
 * dengan "Catat Masukan Pemohon" internal (checkWorkflowAction action "record_feedback") lewat
 * isPublicRequester, termasuk pencegahan keputusan ganda/pengajuan ulang (requesterDecision di qc.ts) —
 * BUKAN jalur terpisah dengan aturan sendiri. Catatan jujur tentang keterbatasan: order number adalah
 * SATU-SATUNYA identifier publik di seluruh sistem ini (sama seperti pencarian riwayat) — tidak ada
 * verifikasi identitas pemohon tambahan (mis. OTP/tautan sekali pakai), konsisten dengan model kepercayaan
 * yang sudah ada di seluruh halaman ini, bukan celah baru.
 */
export async function submitRequesterDecision(
  request: Request,
  input: { orderNumber: string; deliveryId: string; decision: "approved" | "revision"; note?: string; requestKey?: string },
): Promise<TrackingView> {
  const orderNumber = normalizeOrderNumber(input.orderNumber);
  if (!ORDER_NUMBER_RE.test(orderNumber)) throw new AppError("Format nomor order tidak valid, contoh: DTIC-2026-00012.", 422);

  const ip = rateLimit(`track-decide-ip:${clientIp(request)}`, DECIDE_IP_LIMIT, WINDOW_MS);
  if (!ip.ok) throw new AppError(`Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(ip.retryAfterSeconds / 60)} menit.`, 429);

  const order = await findOrderForTracking(orderNumber);
  if (!order) throw new AppError("Nomor order tidak ditemukan. Periksa kembali nomor yang Anda terima saat pengajuan.", 404);

  if (!(await isPublicDeliveryEvent(order.id, input.deliveryId))) throw new AppError("Pengajuan tidak ditemukan atau sudah tidak berlaku. Muat ulang halaman lalu coba lagi.", 404);

  const needsRevision = input.decision === "revision";
  const rawNote = (input.note ?? "").trim();
  if (needsRevision && !rawNote) throw new AppError("Catatan revisi wajib diisi.", 422, { note: "Catatan revisi wajib diisi." });
  const note = (needsRevision ? rawNote : rawNote || "Pemohon menyetujui hasil ini melalui Riwayat Request.").slice(0, 1000);

  await applyWorkflowAction(
    order.id,
    { action: "record_feedback", needsRevision, note, requestKey: input.requestKey },
    { userId: null, name: "Pemohon (publik)", role: "staff", memberId: null, isPublicRequester: true },
  );

  // Sumber kebenaran tunggal: baca ulang dari backend (bukan membangun status baru di sini) — Riwayat
  // Request, timeline, dan halaman PIC semuanya mengikuti data yang SAMA setelah ini.
  return trackOrder(request, orderNumber);
}
