import "server-only";
import type postgres from "postgres";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError } from "@/lib/server/errors";
import {
  annotationStatusAfterRevision,
  finalApprovalProblem,
  formatAnnotationNumber,
  formatRevisionNumber,
  parseGeometry,
  previewKindOf,
  type AnnotationKind,
  type AnnotationStatus,
  type AuthorKind,
  type CommentKind,
  type Geometry,
  type ReviewAnnotation,
  type ReviewPermissions,
  type ReviewRevision,
  type ReviewState,
  type ReviewVersion,
  type RevisionStatus,
} from "@/lib/review";
import { FINISHED_STATUSES, type OrderStatus } from "@/lib/status";

type Q = postgres.Sql | postgres.TransactionSql;

/** Pelaku aksi Review Center. userId null = pemohon publik (tanpa akun). */
export type ReviewActor = { kind: AuthorKind; name: string; userId: string | null };

// ---------------------------------------------------------------- versi (= pengiriman hasil ke pemohon)

type DeliveryRow = { id: string; created_at: Date; actor_name: string | null; detail: Record<string, unknown> };

/**
 * Versi dokumen = satu peristiwa 'delivery_recorded' yang memuat file/tautan hasil (sama persis dengan daftar
 * "Pengajuan #N" di Riwayat Request publik, lihat getPublicDeliveries). Berkas tidak disalin; hanya dirujuk.
 */
export async function loadVersions(q: Q, orderId: string): Promise<ReviewVersion[]> {
  const [events, feedback] = await Promise.all([
    q<DeliveryRow[]>`
      select id, created_at, actor_name, detail from order_workflow_events
      where order_id = ${orderId} and kind = 'delivery_recorded' order by created_at asc, id asc`,
    q<{ created_at: Date; needs_revision: boolean | null }[]>`
      select created_at, needs_revision from order_workflow_events
      where order_id = ${orderId} and kind = 'feedback_recorded' order by created_at asc, id asc`,
  ]);
  const out: ReviewVersion[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const fileIds = Array.isArray(e.detail?.resultFileIds) ? (e.detail.resultFileIds as string[]) : [];
    const linkIds = Array.isArray(e.detail?.resultLinkIds) ? (e.detail.resultLinkIds as string[]) : [];
    if (fileIds.length === 0 && linkIds.length === 0) continue;
    const [files, links] = await Promise.all([
      fileIds.length
        ? q<{ id: string; file_name: string; mime_type: string }[]>`select id, file_name, mime_type from order_attachments where id in ${q(fileIds)} and order_id = ${orderId} and kind = 'result' order by file_name`
        : Promise.resolve([] as { id: string; file_name: string; mime_type: string }[]),
      linkIds.length
        ? q<{ id: string; title: string; url: string }[]>`select id, title, url from order_result_links where id in ${q(linkIds)} and order_id = ${orderId}`
        : Promise.resolve([] as { id: string; title: string; url: string }[]),
    ]);
    if (files.length === 0 && links.length === 0) continue;
    const nextAt = events[i + 1]?.created_at.getTime() ?? Infinity;
    const window = feedback.filter((f) => f.created_at.getTime() >= e.created_at.getTime() && f.created_at.getTime() < nextAt);
    const latest = window.at(-1);
    out.push({
      deliveryId: e.id,
      versionNo: out.length + 1,
      at: e.created_at.toISOString(),
      deliveredBy: e.actor_name,
      files: files.map((f) => ({ id: f.id, fileName: f.file_name, mimeType: f.mime_type, previewKind: previewKindOf(f.mime_type, f.file_name) })),
      links: links.map((l) => ({ id: l.id, title: l.title, url: l.url })),
      decision: !latest ? "awaiting" : latest.needs_revision === false ? "approved" : "revision_requested",
      isLatest: false,
    });
  }
  if (out.length > 0) out[out.length - 1].isLatest = true;
  return out;
}

// ---------------------------------------------------------------- peristiwa riwayat order

export async function insertReviewEvent(q: Q, orderId: string, kind: string, actor: ReviewActor, summary: string, detail: Record<string, unknown>) {
  await q`
    insert into order_workflow_events (order_id, kind, actor_user_id, actor_name, summary, detail)
    values (${orderId}, ${kind}, ${actor.userId}, ${actor.name}, ${summary.slice(0, 1000)}, ${q.json(detail as postgres.JSONValue)})`;
}

async function lockOrder(tx: postgres.TransactionSql, orderId: string): Promise<{ status: OrderStatus }> {
  const [o] = await tx<{ status: OrderStatus }[]>`select status from orders where id = ${orderId} for update`;
  if (!o) throw new NotFoundError("Order tidak ditemukan.");
  return o;
}

function assertOpen(status: OrderStatus) {
  if (FINISHED_STATUSES.includes(status)) throw new AppError("Pekerjaan sudah selesai atau dibatalkan; Review Center hanya dapat dibaca.", 409);
}

// ---------------------------------------------------------------- baca status lengkap

type AnnRow = {
  id: string; number: number; delivery_id: string; version_no: number; attachment_id: string | null; link_id: string | null;
  kind: AnnotationKind; page: number | null; geometry: Geometry | null; quote: string | null; reference: string | null;
  status: AnnotationStatus; created_by_kind: AuthorKind; created_by_name: string; created_at: Date;
};
type CommentRow = { id: string; annotation_id: string; body: string; kind: CommentKind; author_kind: AuthorKind; author_name: string; created_at: Date };
type RevRow = {
  id: string; number: number; status: RevisionStatus; note: string | null; reviewed_version_no: number; delivered_version_no: number | null;
  requested_by_name: string; created_at: Date; started_at: Date | null; approved_by_name: string | null; approved_at: Date | null; resubmitted_at: Date | null;
};

export async function getReviewState(
  orderId: string,
  viewer: { kind: "requester" | "staff" | "manager" | "super_admin"; orderNumber: string; orderStatus: OrderStatus; exposeOrderId: boolean },
): Promise<ReviewState> {
  const db = sql();
  const [versions, annRows, commentRows, revRows, itemRows] = await Promise.all([
    loadVersions(db, orderId),
    db<AnnRow[]>`
      select id, number, delivery_id, version_no, attachment_id, link_id, kind, page, geometry, quote, reference, status, created_by_kind, created_by_name, created_at
      from review_annotations where order_id = ${orderId} order by number`,
    db<CommentRow[]>`
      select id, annotation_id, body, kind, author_kind, author_name, created_at from review_comments
      where order_id = ${orderId} order by created_at, id`,
    db<RevRow[]>`
      select id, number, status, note, reviewed_version_no, delivered_version_no, requested_by_name, created_at, started_at, approved_by_name, approved_at, resubmitted_at
      from revision_requests where order_id = ${orderId} order by number`,
    db<{ revision_id: string; annotation_id: string }[]>`
      select i.revision_id, i.annotation_id from revision_request_items i join revision_requests r on r.id = i.revision_id
      where r.order_id = ${orderId} order by i.created_at, i.id`,
  ]);

  const revNumberById = new Map(revRows.map((r) => [r.id, r.number]));
  const itemsByRev = new Map<string, string[]>();
  const latestRevByAnn = new Map<string, number>();
  for (const it of itemRows) {
    (itemsByRev.get(it.revision_id) ?? itemsByRev.set(it.revision_id, []).get(it.revision_id)!).push(it.annotation_id);
    const n = revNumberById.get(it.revision_id);
    if (n !== undefined) latestRevByAnn.set(it.annotation_id, Math.max(n, latestRevByAnn.get(it.annotation_id) ?? 0));
  }
  const commentsByAnn = new Map<string, ReviewAnnotation["comments"]>();
  for (const c of commentRows) {
    const list = commentsByAnn.get(c.annotation_id) ?? [];
    list.push({ id: c.id, annotationId: c.annotation_id, body: c.body, kind: c.kind, authorKind: c.author_kind, authorName: c.author_name, at: c.created_at.toISOString() });
    commentsByAnn.set(c.annotation_id, list);
  }
  const annotations: ReviewAnnotation[] = annRows.map((a) => ({
    id: a.id, number: a.number, deliveryId: a.delivery_id, versionNo: a.version_no, attachmentId: a.attachment_id, linkId: a.link_id,
    kind: a.kind, page: a.page, geometry: a.geometry, quote: a.quote, reference: a.reference, status: a.status,
    createdByKind: a.created_by_kind, createdByName: a.created_by_name, at: a.created_at.toISOString(),
    comments: commentsByAnn.get(a.id) ?? [], revisionNumber: latestRevByAnn.get(a.id) ?? null,
  }));
  const revisions: ReviewRevision[] = revRows.map((r) => ({
    id: r.id, number: r.number, status: r.status, note: r.note, reviewedVersionNo: r.reviewed_version_no, deliveredVersionNo: r.delivered_version_no,
    requestedByName: r.requested_by_name, at: r.created_at.toISOString(), startedAt: r.started_at?.toISOString() ?? null,
    approvedByName: r.approved_by_name, approvedAt: r.approved_at?.toISOString() ?? null, resubmittedAt: r.resubmitted_at?.toISOString() ?? null,
    annotationIds: itemsByRev.get(r.id) ?? [],
  }));

  const closed = FINISHED_STATUSES.includes(viewer.orderStatus);
  const latest = versions.at(-1);
  const awaiting = !closed && viewer.orderStatus === "awaiting_requester" && latest?.decision === "awaiting";
  const finalProblem = finalApprovalProblem(revisions);
  const hasVersions = versions.length > 0;
  const writer = viewer.kind === "requester" || viewer.kind === "staff" || viewer.kind === "super_admin";
  const staffWriter = viewer.kind === "staff" || viewer.kind === "super_admin";
  const permissions: ReviewPermissions = {
    canAnnotate: !closed && hasVersions && writer,
    canComment: !closed && hasVersions && writer,
    canClarify: !closed && hasVersions && staffWriter,
    canStartRevision: !closed && staffWriter && revisions.some((r) => r.status === "waiting_pic"),
    canRequestRevision: viewer.kind === "requester" && awaiting,
    canApproveRevision: viewer.kind === "requester" && !closed && revisions.some((r) => r.status === "waiting_requester_check"),
    canFinalApprove: viewer.kind === "requester" && awaiting && finalProblem === null,
    finalApprovalBlockedReason: viewer.kind === "requester" && awaiting ? finalProblem : null,
    readOnly: closed || !writer,
  };
  return { orderId: viewer.exposeOrderId ? orderId : null, orderNumber: viewer.orderNumber, orderClosed: closed, viewer: viewer.kind, versions, annotations, revisions, permissions };
}

// ---------------------------------------------------------------- highlight

export type CreateAnnotationInput = {
  deliveryId: string;
  attachmentId: string | null;
  linkId: string | null;
  kind: AnnotationKind;
  page: number | null;
  geometry: unknown;
  quote: string | null;
  reference: string | null;
  comment: string;
  requestKey: string | null;
};

export async function createAnnotation(orderId: string, actor: ReviewActor, input: CreateAnnotationInput): Promise<{ id: string; number: number; duplicate: boolean }> {
  const comment = input.comment.trim();
  if (comment.length < 1 || comment.length > 2000) throw new AppError("Komentar wajib diisi (maksimal 2000 karakter).", 422, { comment: "Komentar wajib diisi (maksimal 2000 karakter)." });
  if ((input.attachmentId === null) === (input.linkId === null)) throw new AppError("Pilih satu dokumen atau satu tautan.", 422);
  let geometry: Geometry | null = null;
  if (input.kind === "area" || input.kind === "text") {
    geometry = parseGeometry(input.geometry);
    if (!geometry) throw new AppError("Posisi highlight tidak valid.", 422, { geometry: "Posisi highlight tidak valid." });
    if (!Number.isInteger(input.page) || (input.page as number) < 1 || (input.page as number) > 10000) throw new AppError("Nomor halaman tidak valid.", 422, { page: "Nomor halaman tidak valid." });
    if (input.kind === "text" && !input.quote?.trim()) throw new AppError("Teks yang dipilih kosong.", 422, { quote: "Teks yang dipilih kosong." });
  } else if (!input.reference?.trim()) {
    throw new AppError("Tulis referensi manual (mis. halaman/slide dan kalimat).", 422, { reference: "Referensi wajib diisi." });
  }
  const quote = input.kind === "text" ? input.quote!.trim().slice(0, 600) : null;
  const reference = input.kind === "manual" ? input.reference!.trim().slice(0, 300) : null;

  return sql().begin(async (tx) => {
    const o = await lockOrder(tx, orderId);
    assertOpen(o.status);
    if (input.requestKey) {
      const [dup] = await tx<{ id: string; number: number }[]>`select id, number from review_annotations where order_id = ${orderId} and request_key = ${input.requestKey}`;
      if (dup) return { id: dup.id, number: dup.number, duplicate: true };
    }
    const versions = await loadVersions(tx, orderId);
    const version = versions.find((v) => v.deliveryId === input.deliveryId);
    if (!version) throw new AppError("Versi dokumen tidak ditemukan atau belum diserahkan kepada pemohon.", 404);
    if (input.attachmentId) {
      const file = version.files.find((f) => f.id === input.attachmentId);
      if (!file) throw new AppError("Dokumen bukan bagian dari versi ini.", 404);
      if (input.kind !== "manual" && file.previewKind === "none") throw new AppError("Format dokumen ini tidak mendukung highlight langsung; gunakan referensi manual.", 422);
      if (input.kind !== "manual" && file.previewKind === "image" && input.page !== 1) throw new AppError("Gambar hanya memiliki satu halaman.", 422, { page: "Gambar hanya memiliki satu halaman." });
    } else if (!version.links.some((l) => l.id === input.linkId)) {
      throw new AppError("Tautan bukan bagian dari versi ini.", 404);
    } else if (input.kind !== "manual") {
      throw new AppError("Tautan eksternal hanya mendukung referensi manual.", 422);
    }
    const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(number), 0)::int + 1 as n from review_annotations where order_id = ${orderId}`;
    const [row] = await tx<{ id: string }[]>`
      insert into review_annotations (order_id, number, delivery_id, version_no, attachment_id, link_id, kind, page, geometry, quote, reference,
                                      created_by_kind, created_by_name, created_by_user_id, request_key)
      values (${orderId}, ${n}, ${version.deliveryId}, ${version.versionNo}, ${input.attachmentId}, ${input.linkId}, ${input.kind}, ${input.kind === "manual" ? (input.page && input.page >= 1 ? input.page : null) : input.page},
              ${geometry ? tx.json(geometry as unknown as postgres.JSONValue) : null}, ${quote}, ${reference}, ${actor.kind}, ${actor.name}, ${actor.userId}, ${input.requestKey})
      returning id`;
    await tx`
      insert into review_comments (annotation_id, order_id, body, kind, author_kind, author_name, author_user_id)
      values (${row.id}, ${orderId}, ${comment}, 'comment', ${actor.kind}, ${actor.name}, ${actor.userId})`;
    await insertReviewEvent(tx, orderId, "review_highlight_added", actor, `Highlight ${formatAnnotationNumber(n)} pada versi ${version.versionNo}: ${comment}`, {
      annotationId: row.id, number: n, versionNo: version.versionNo, page: input.page ?? null, kind: input.kind,
    });
    return { id: row.id, number: n, duplicate: false };
  });
}

// ---------------------------------------------------------------- komentar / klarifikasi

export async function addComment(
  orderId: string,
  actor: ReviewActor,
  input: { annotationId: string; body: string; kind: "comment" | "clarification_request"; requestKey: string | null },
): Promise<{ id: string; kind: CommentKind; duplicate: boolean }> {
  const body = input.body.trim();
  if (body.length < 1 || body.length > 2000) throw new AppError("Komentar wajib diisi (maksimal 2000 karakter).", 422, { body: "Komentar wajib diisi (maksimal 2000 karakter)." });
  return sql().begin(async (tx) => {
    const o = await lockOrder(tx, orderId);
    assertOpen(o.status);
    if (input.requestKey) {
      const [dup] = await tx<{ id: string; kind: CommentKind }[]>`select id, kind from review_comments where order_id = ${orderId} and request_key = ${input.requestKey}`;
      if (dup) return { id: dup.id, kind: dup.kind, duplicate: true };
    }
    const [a] = await tx<{ id: string; number: number; status: AnnotationStatus; status_before_clarification: AnnotationStatus | null }[]>`
      select id, number, status, status_before_clarification from review_annotations where id = ${input.annotationId} and order_id = ${orderId} for update`;
    if (!a) throw new NotFoundError("Highlight tidak ditemukan.");

    let kind: CommentKind = "comment";
    let nextStatus: AnnotationStatus | null = null;
    if (actor.kind === "requester") {
      if (a.status === "waiting_clarification") {
        kind = "clarification_answer";
        nextStatus = a.status_before_clarification && a.status_before_clarification !== "waiting_clarification" ? a.status_before_clarification : "not_submitted";
      }
    } else if (input.kind === "clarification_request") {
      kind = "clarification_request";
      if (!(["not_submitted", "waiting_pic", "in_progress"] as AnnotationStatus[]).includes(a.status)) {
        throw new AppError(`Klarifikasi tidak dapat diminta pada highlight berstatus "${a.status}".`, 409);
      }
      nextStatus = "waiting_clarification";
    }
    const [c] = await tx<{ id: string }[]>`
      insert into review_comments (annotation_id, order_id, body, kind, author_kind, author_name, author_user_id, request_key)
      values (${a.id}, ${orderId}, ${body}, ${kind}, ${actor.kind}, ${actor.name}, ${actor.userId}, ${input.requestKey}) returning id`;
    if (nextStatus) {
      if (kind === "clarification_request") await tx`update review_annotations set status = ${nextStatus}, status_before_clarification = ${a.status} where id = ${a.id}`;
      else await tx`update review_annotations set status = ${nextStatus}, status_before_clarification = null where id = ${a.id}`;
    }
    const eventKind = kind === "clarification_request" ? "review_clarification_requested" : kind === "clarification_answer" ? "review_clarification_answered" : "review_comment_added";
    await insertReviewEvent(tx, orderId, eventKind, actor, `Highlight ${formatAnnotationNumber(a.number)}: ${body}`, { annotationId: a.id, number: a.number, commentId: c.id, statusAfter: nextStatus ?? a.status });
    return { id: c.id, kind, duplicate: false };
  });
}

// ---------------------------------------------------------------- Request Revisi

type RevisionLockRow = { id: string; number: number; status: RevisionStatus };

async function lockRevision(tx: postgres.TransactionSql, orderId: string, revisionId: string): Promise<RevisionLockRow> {
  const [r] = await tx<RevisionLockRow[]>`select id, number, status from revision_requests where id = ${revisionId} and order_id = ${orderId} for update`;
  if (!r) throw new NotFoundError("Request Revisi tidak ditemukan.");
  return r;
}

/** PIC mulai mengerjakan revisi: REV Menunggu PIC → Sedang Dikerjakan; highlight Menunggu PIC → Sedang diperbaiki. */
export async function startRevision(orderId: string, actor: ReviewActor, revisionId: string): Promise<void> {
  await sql().begin(async (tx) => {
    const o = await lockOrder(tx, orderId);
    assertOpen(o.status);
    const r = await lockRevision(tx, orderId, revisionId);
    if (r.status !== "waiting_pic") throw new AppError(`${formatRevisionNumber(r.number)} tidak sedang menunggu PIC.`, 409);
    await tx`update revision_requests set status = 'in_progress', started_by_name = ${actor.name}, started_at = now() where id = ${r.id}`;
    await tx`
      update review_annotations set status = ${annotationStatusAfterRevision("waiting_pic", "started")}
      where status = 'waiting_pic' and id in (select annotation_id from revision_request_items where revision_id = ${r.id})`;
    await insertReviewEvent(tx, orderId, "revision_started", actor, `${formatRevisionNumber(r.number)} mulai dikerjakan.`, { revisionId: r.id, revisionNumber: r.number });
  });
}

/** Pemohon menyetujui hasil SATU Request Revisi sekaligus (bukan per highlight). Tidak menyetujui seluruh pekerjaan. */
export async function approveRevision(orderId: string, actor: ReviewActor, revisionId: string): Promise<void> {
  await sql().begin(async (tx) => {
    const o = await lockOrder(tx, orderId);
    assertOpen(o.status);
    const r = await lockRevision(tx, orderId, revisionId);
    if (r.status !== "waiting_requester_check") throw new AppError(`${formatRevisionNumber(r.number)} belum menunggu pemeriksaan Anda.`, 409);
    await tx`update revision_requests set status = 'approved', approved_by_name = ${actor.name}, approved_at = now() where id = ${r.id}`;
    await tx`
      update review_annotations set status = ${annotationStatusAfterRevision("waiting_check", "approved")}
      where status = 'waiting_check' and id in (select annotation_id from revision_request_items where revision_id = ${r.id})`;
    await insertReviewEvent(tx, orderId, "revision_approved", actor, `${formatRevisionNumber(r.number)} disetujui pemohon.`, { revisionId: r.id, revisionNumber: r.number });
  });
}

/** "Ajukan Revisi Kembali": hasil REV belum sesuai. REV → Diajukan Kembali; highlight-nya dilepas agar bisa dipilih lagi. */
export async function resubmitRevision(orderId: string, actor: ReviewActor, revisionId: string): Promise<void> {
  await sql().begin(async (tx) => {
    const o = await lockOrder(tx, orderId);
    assertOpen(o.status);
    const r = await lockRevision(tx, orderId, revisionId);
    if (r.status !== "waiting_requester_check") throw new AppError(`${formatRevisionNumber(r.number)} belum menunggu pemeriksaan Anda.`, 409);
    await releaseRevision(tx, orderId, r, actor);
  });
}

async function releaseRevision(tx: postgres.TransactionSql, orderId: string, r: RevisionLockRow, actor: ReviewActor) {
  await tx`update revision_requests set status = 'resubmitted', resubmitted_at = now() where id = ${r.id}`;
  await tx`
    update review_annotations set status = ${annotationStatusAfterRevision("waiting_check", "resubmitted")}
    where status = 'waiting_check' and id in (select annotation_id from revision_request_items where revision_id = ${r.id})`;
  await insertReviewEvent(tx, orderId, "revision_resubmitted", actor, `${formatRevisionNumber(r.number)} diajukan kembali (hasil belum sesuai).`, { revisionId: r.id, revisionNumber: r.number });
}

// ---------------------------------------------------------------- kait di dalam applyWorkflowAction (transaksi yang sama)

/**
 * Dipanggil applyWorkflowAction SETELAH 'delivery_recorded' tersimpan: setiap Request Revisi yang menunggu PIC
 * kini punya hasil baru (versi baru) untuk diperiksa pemohon. Dipanggil dari satu tempat supaya konsisten
 * siapa pun yang mencatat pengiriman (PIC lewat panel QC atau jalur lain).
 */
export async function reviewOnDelivery(tx: postgres.TransactionSql, orderId: string, deliveryEventId: string): Promise<void> {
  const revs = await tx<RevisionLockRow[]>`
    select id, number, status from revision_requests where order_id = ${orderId} and status in ('waiting_pic', 'in_progress') order by number for update`;
  if (revs.length === 0) return;
  const versions = await loadVersions(tx, orderId);
  const version = versions.find((v) => v.deliveryId === deliveryEventId) ?? null;
  const [e] = await tx<{ actor_name: string | null }[]>`select actor_name from order_workflow_events where id = ${deliveryEventId}`;
  const actor: ReviewActor = { kind: "staff", name: e?.actor_name ?? "PIC", userId: null };
  for (const r of revs) {
    await tx`
      update revision_requests set status = 'waiting_requester_check', delivered_delivery_id = ${deliveryEventId}, delivered_version_no = ${version?.versionNo ?? null}
      where id = ${r.id}`;
    await tx`
      update review_annotations set status = ${annotationStatusAfterRevision("in_progress", "delivered")}
      where status in ('waiting_pic', 'in_progress', 'waiting_clarification') and id in (select annotation_id from revision_request_items where revision_id = ${r.id})`;
    await insertReviewEvent(tx, orderId, "revision_delivered", actor, `Hasil ${formatRevisionNumber(r.number)} diserahkan${version ? ` (versi ${version.versionNo})` : ""}.`, {
      revisionId: r.id, revisionNumber: r.number, versionNo: version?.versionNo ?? null, deliveryId: deliveryEventId,
    });
  }
}

/** Pemohon meminta revisi lewat jalur mana pun: REV yang sedang menunggu pemeriksaannya dianggap diajukan kembali. */
export async function reviewOnRevisionDecision(tx: postgres.TransactionSql, orderId: string, actorName: string): Promise<void> {
  const revs = await tx<RevisionLockRow[]>`select id, number, status from revision_requests where order_id = ${orderId} and status = 'waiting_requester_check' order by number for update`;
  for (const r of revs) await releaseRevision(tx, orderId, r, { kind: "requester", name: actorName, userId: null });
}

/** Persetujuan akhir ditolak selama ada Request Revisi yang belum selesai (berlaku untuk SEMUA jalur persetujuan). */
export async function assertNoOpenRevisions(tx: postgres.TransactionSql, orderId: string): Promise<void> {
  const revs = await tx<{ number: number; status: RevisionStatus }[]>`select number, status from revision_requests where order_id = ${orderId} order by number`;
  const problem = finalApprovalProblem(revs);
  if (problem) throw new AppError(problem, 409);
}

/** Versi & nomor Request Revisi yang melekat pada persetujuan akhir (dicatat di peristiwa feedback_recorded). */
export async function approvedVersionInfo(tx: postgres.TransactionSql, orderId: string): Promise<{ deliveryId: string; versionNo: number } | null> {
  const versions = await loadVersions(tx, orderId);
  const latest = versions.at(-1);
  return latest ? { deliveryId: latest.deliveryId, versionNo: latest.versionNo } : null;
}

