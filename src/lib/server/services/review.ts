import "server-only";
import type postgres from "postgres";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { UUID_RE } from "@/lib/server/http";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { findOrderForTracking } from "@/lib/server/repositories/orders";
import { applyWorkflowAction } from "@/lib/server/repositories/qc";
import {
  addComment,
  approveRevision,
  createAnnotation,
  getReviewState,
  insertReviewEvent,
  loadVersions,
  resubmitRevision,
  startRevision,
  type ReviewActor,
} from "@/lib/server/repositories/review";
import { normalizeOrderNumber, ORDER_NUMBER_RE } from "@/lib/server/services/tracking";
import type { Session } from "@/lib/server/auth";
import {
  ANNOTATION_KINDS,
  annotationStatusAfterRevision,
  formatAnnotationNumber,
  formatRevisionNumber,
  revisionSelectionProblem,
  type AnnotationKind,
  type AnnotationStatus,
  type ReviewState,
} from "@/lib/review";
import { sql } from "@/lib/server/db";

const WINDOW_MS = 15 * 60_000;
const READ_LIMIT = 300;
const WRITE_LIMIT = 150;

type Body = Record<string, unknown>;
const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const uuidOrNull = (v: unknown, what: string): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new AppError(`${what} tidak valid.`, 422);
  return v;
};
const requireUuid = (v: unknown, what: string): string => {
  const id = uuidOrNull(v, what);
  if (!id) throw new AppError(`${what} wajib diisi.`, 422);
  return id;
};

// ---------------------------------------------------------------- Pemohon (publik, tanpa akun)

async function resolvePublicOrder(request: Request, rawOrderNumber: unknown, kind: "read" | "write") {
  const orderNumber = normalizeOrderNumber(typeof rawOrderNumber === "string" ? rawOrderNumber : "");
  if (!ORDER_NUMBER_RE.test(orderNumber)) throw new AppError("Format nomor order tidak valid, contoh: DTIC-2026-00012.", 422);
  const limit = rateLimit(`review-${kind}-ip:${clientIp(request)}`, kind === "read" ? READ_LIMIT : WRITE_LIMIT, WINDOW_MS);
  if (!limit.ok) throw new AppError(`Terlalu banyak permintaan. Coba lagi dalam ${Math.ceil(limit.retryAfterSeconds / 60)} menit.`, 429);
  const order = await findOrderForTracking(orderNumber);
  if (!order) throw new NotFoundError("Nomor order tidak ditemukan. Periksa kembali nomor yang Anda terima saat pengajuan.");
  return { order, orderNumber };
}

async function publicState(order: { id: string; status: ReviewStateStatus }, orderNumber: string): Promise<ReviewState> {
  return getReviewState(order.id, { kind: "requester", orderNumber, orderStatus: order.status, exposeOrderId: false });
}
type ReviewStateStatus = Parameters<typeof getReviewState>[1]["orderStatus"];

export async function publicReviewRead(request: Request, rawOrderNumber: unknown): Promise<ReviewState> {
  const { order, orderNumber } = await resolvePublicOrder(request, rawOrderNumber, "read");
  return publicState(order, orderNumber);
}

/** Satu pintu aksi Pemohon. Nomor order = satu-satunya identifier (model kepercayaan sama dengan Setujui Hasil). */
export async function publicReviewAction(request: Request, body: Body): Promise<ReviewState> {
  const { order, orderNumber } = await resolvePublicOrder(request, body.orderNumber, "write");
  const actor: ReviewActor = { kind: "requester", name: `${order.requester_name} (Pemohon)`, userId: null };
  await runAction(order.id, actor, body, { requester: true });
  const fresh = await findOrderForTracking(orderNumber);
  return publicState(fresh ?? order, orderNumber);
}

// ---------------------------------------------------------------- internal (PIC / Manager / Super Admin)

export function reviewViewerKind(session: Session): "staff" | "manager" | "super_admin" {
  return session.role === "super_admin" ? "super_admin" : session.role === "manager" ? "manager" : "staff";
}

export async function internalReviewRead(session: Session, orderId: string): Promise<ReviewState> {
  const [o] = await sql()<{ order_number: string; status: ReviewStateStatus }[]>`select order_number, status from orders where id = ${orderId}`;
  if (!o) throw new NotFoundError("Order tidak ditemukan.");
  return getReviewState(orderId, { kind: reviewViewerKind(session), orderNumber: o.order_number, orderStatus: o.status, exposeOrderId: true });
}

/** Aksi PIC: hanya PIC yang ditugaskan (akses sudah diperiksa pemanggil lewat canAccessOrder) dan Super Admin. Manager: baca saja. */
export async function internalReviewAction(session: Session, orderId: string, body: Body): Promise<ReviewState> {
  const viewer = reviewViewerKind(session);
  if (viewer === "manager") throw new AppError("Manager memantau Review Center (hanya baca). Tindakan dilakukan oleh PIC.", 403);
  const actor: ReviewActor = { kind: viewer, name: session.name, userId: session.userId };
  await runAction(orderId, actor, body, { requester: false });
  return internalReviewRead(session, orderId);
}

// ---------------------------------------------------------------- aksi bersama

async function runAction(orderId: string, actor: ReviewActor, body: Body, who: { requester: boolean }): Promise<void> {
  const action = body.action;
  switch (action) {
    case "annotate": {
      const kind = body.kind as AnnotationKind;
      if (!ANNOTATION_KINDS.includes(kind)) throw new AppError("Jenis highlight tidak valid.", 422);
      await createAnnotation(orderId, actor, {
        deliveryId: requireUuid(body.deliveryId, "Versi dokumen"),
        attachmentId: uuidOrNull(body.attachmentId, "Dokumen"),
        linkId: uuidOrNull(body.linkId, "Tautan"),
        kind,
        page: typeof body.page === "number" ? body.page : null,
        geometry: body.geometry,
        quote: str(body.quote, 2000),
        reference: str(body.reference, 600),
        comment: str(body.comment, 5000) ?? "",
        requestKey: uuidOrNull(body.requestKey, "Kunci permintaan"),
      });
      return;
    }
    case "comment": {
      const wantsClarification = body.kind === "clarification_request";
      if (wantsClarification && who.requester) throw new AppError("Hanya PIC yang dapat meminta klarifikasi.", 403);
      await addComment(orderId, actor, {
        annotationId: requireUuid(body.annotationId, "Highlight"),
        body: str(body.body, 5000) ?? "",
        kind: wantsClarification ? "clarification_request" : "comment",
        requestKey: uuidOrNull(body.requestKey, "Kunci permintaan"),
      });
      return;
    }
    case "create_revision": {
      if (!who.requester) throw new AppError("Hanya pemohon yang dapat mengajukan Request Revisi.", 403);
      const ids = Array.isArray(body.annotationIds) ? body.annotationIds : null;
      if (!ids || ids.length > 100 || !ids.every((i) => typeof i === "string" && UUID_RE.test(i))) throw new AppError("Pilihan highlight tidak valid.", 422, { annotationIds: "Pilihan highlight tidak valid." });
      await createRevisionRequest(orderId, actor, { annotationIds: ids as string[], note: str(body.note, 600), requestKey: uuidOrNull(body.requestKey, "Kunci permintaan") });
      return;
    }
    case "approve_revision":
      if (!who.requester) throw new AppError("Hanya pemohon yang dapat menyetujui hasil revisi.", 403);
      await approveRevision(orderId, actor, requireUuid(body.revisionId, "Request Revisi"));
      return;
    case "resubmit_revision":
      if (!who.requester) throw new AppError("Hanya pemohon yang dapat mengajukan revisi kembali.", 403);
      await resubmitRevision(orderId, actor, requireUuid(body.revisionId, "Request Revisi"));
      return;
    case "start_revision":
      if (who.requester) throw new AppError("Hanya PIC yang dapat memulai pengerjaan revisi.", 403);
      await startRevision(orderId, actor, requireUuid(body.revisionId, "Request Revisi"));
      return;
    default:
      throw new AppError("Aksi tidak dikenal.", 422);
  }
}

/**
 * Pemohon mengajukan Request Revisi dari highlight terpilih. Memakai aksi workflow 'record_feedback' (revisi) yang
 * SUDAH ada — status pekerjaan/QC berubah persis seperti "Minta Revisi" biasa; yang ditambahkan hanya catatan
 * REV-NNN beserta highlight-nya, dalam transaksi & kunci order yang SAMA (tidak ada keadaan setengah jadi).
 */
export async function createRevisionRequest(
  orderId: string,
  actor: ReviewActor,
  input: { annotationIds: string[]; note: string | null; requestKey: string | null },
): Promise<{ id: string; number: number; duplicate: boolean }> {
  const extraNote = (input.note ?? "").trim().slice(0, 600);
  const created: { id: string | null; number: number | null } = { id: null, number: null };
  let result;
  try {
    result = await applyWorkflowAction(
      orderId,
      { action: "record_feedback", needsRevision: true, note: "Request Revisi", requestKey: input.requestKey ?? undefined },
      { userId: actor.userId, name: actor.name, role: "staff", memberId: null, isPublicRequester: true },
      {
        before: async (tx: postgres.TransactionSql) => {
          const anns = await tx<{ id: string; number: number; status: AnnotationStatus }[]>`select id, number, status from review_annotations where order_id = ${orderId} for update`;
          const problem = revisionSelectionProblem(input.annotationIds, anns);
          if (problem) throw new AppError(problem, 422, { annotationIds: problem });
          const latest = (await loadVersions(tx, orderId)).at(-1);
          if (!latest) throw new AppError("Belum ada hasil yang diserahkan untuk direview.", 409);
          const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(number), 0)::int + 1 as n from revision_requests where order_id = ${orderId}`;
          const numbers = input.annotationIds.map((id) => anns.find((a) => a.id === id)!.number).sort((a, b) => a - b);
          const [rev] = await tx<{ id: string }[]>`
            insert into revision_requests (order_id, number, reviewed_delivery_id, reviewed_version_no, status, note, requested_by_name)
            values (${orderId}, ${n}, ${latest.deliveryId}, ${latest.versionNo}, 'waiting_pic', ${extraNote || null}, ${actor.name}) returning id`;
          for (const id of input.annotationIds) await tx`insert into revision_request_items (revision_id, annotation_id) values (${rev.id}, ${id})`;
          await tx`update review_annotations set status = ${annotationStatusAfterRevision("not_submitted", "created")} where id in ${tx(input.annotationIds)}`;
          created.id = rev.id;
          created.number = n;
          const note = `${formatRevisionNumber(n)} — ${numbers.length} catatan (${numbers.map(formatAnnotationNumber).join(", ")}).${extraNote ? ` ${extraNote}` : ""}`;
          return { note, detail: { revisionId: rev.id, revisionNumber: n, annotationNumbers: numbers, reviewedVersionNo: latest.versionNo } };
        },
        after: async (tx: postgres.TransactionSql, ctx) => {
          if (!created.id) return;
          await tx`update revision_requests set feedback_event_id = ${ctx.eventId} where id = ${created.id}`;
          await insertReviewEvent(tx, orderId, "revision_created", actor, `${formatRevisionNumber(created.number!)} diajukan.`, {
            revisionId: created.id, revisionNumber: created.number, feedbackEventId: ctx.eventId,
          });
        },
      },
    );
  } catch (error) {
    // Pesan aturan QC umum ("Masukan dicatat setelah hasil...") dibuat lebih jelas untuk konteks Review Center.
    if (error instanceof AppError && error.status === 409 && /Masukan dicatat/.test(error.message)) {
      throw new AppError("Request Revisi hanya dapat diajukan setelah PIC menyerahkan hasil dan menunggu keputusan Anda.", 409);
    }
    throw error;
  }
  if (result.duplicate) {
    // Permintaan ulang dengan requestKey yang sama: tidak membuat apa pun — kembalikan REV yang sudah ada.
    const [r] = await sql()<{ id: string; number: number }[]>`
      select r.id, r.number from revision_requests r join order_workflow_events e on e.id = r.feedback_event_id
      where r.order_id = ${orderId} and e.request_key = ${input.requestKey} limit 1`;
    if (!r) throw new AppError("Permintaan ini sudah diproses.", 409);
    return { id: r.id, number: r.number, duplicate: true };
  }
  return { id: created.id!, number: created.number!, duplicate: false };
}
