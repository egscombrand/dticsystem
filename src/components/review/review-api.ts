import { ApiError, internalRequest } from "@/lib/client/api";
import type { ReviewState } from "@/lib/review";

/** Konteks Review Center: Pemohon (publik, nomor order) atau pengguna internal (id order). */
export type ReviewCtx = { mode: "requester"; orderNumber: string } | { mode: "internal"; orderId: string };

const stateUrl = (ctx: ReviewCtx) =>
  ctx.mode === "requester" ? `/api/public/tracking/review?order=${encodeURIComponent(ctx.orderNumber)}` : `/api/internal/orders/${ctx.orderId}/review`;

export async function fetchReviewState(ctx: ReviewCtx): Promise<ReviewState> {
  let res: Response;
  try {
    res = await fetch(stateUrl(ctx), { cache: "no-store" });
  } catch {
    throw new ApiError("Tidak dapat terhubung ke server. Periksa koneksi internet Anda.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string } & Partial<ReviewState>;
  if (!res.ok) throw new ApiError(data.error ?? `Permintaan gagal (HTTP ${res.status}).`, res.status);
  return data as ReviewState;
}

/** Aksi Review Center; server mengembalikan keadaan terbaru (sumber kebenaran tunggal). */
export function postReviewAction(ctx: ReviewCtx, body: Record<string, unknown>): Promise<ReviewState> {
  return ctx.mode === "requester"
    ? internalRequest<ReviewState>("/api/public/tracking/review", "POST", { orderNumber: ctx.orderNumber, ...body })
    : internalRequest<ReviewState>(`/api/internal/orders/${ctx.orderId}/review`, "POST", body);
}

export const newRequestKey = () => crypto.randomUUID();
