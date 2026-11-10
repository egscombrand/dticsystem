import "server-only";
import type postgres from "postgres";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError, pgConstraint, pgErrorCode } from "@/lib/server/errors";
import {
  groupMessageActivity,
  sortActivity,
  type ActivityItem,
  type BriefChange,
  type BriefChangeStatus,
  type BriefVersion,
  type ChatAttachment,
  type ChatMessage,
  type OrderBadges,
  type ReferenceFile,
  type SenderKind,
} from "@/lib/collab";
import type { RichDoc } from "@/lib/rich-text";
import { briefChangeProblem } from "@/lib/collab";
import { FINISHED_STATUSES, type OrderStatus } from "@/lib/status";
import { clientStatusLabel } from "@/lib/tracking-labels";
import { toCurrentStatus } from "@/lib/status";

type Q = postgres.Sql | postgres.TransactionSql;

/** Pembaca status baca: Pemohon = ("requester", ""); pembaca internal = (peran, id akun). */
export type Reader = { kind: Exclude<SenderKind, "system">; key: string };
export const REQUESTER_READER: Reader = { kind: "requester", key: "" };

export type MessageSender = { kind: SenderKind; name: string; userId: string | null };
export type NewMessageAttachment = { fileName: string; storagePath: string; mimeType: string; fileSize: number };

// ---------------------------------------------------------------- pesan

type MsgRow = { id: string; seq: number; sender_kind: SenderKind; sender_name: string; body: string; created_at: Date };
type AttRow = { id: string; message_id: string; file_name: string; mime_type: string; file_size: number };

function toMessage(r: MsgRow, atts: AttRow[]): ChatMessage {
  return {
    id: r.id,
    seq: r.seq,
    senderKind: r.sender_kind,
    senderName: r.sender_name,
    body: r.body,
    createdAt: r.created_at.toISOString(),
    attachments: atts.filter((a) => a.message_id === r.id).map((a): ChatAttachment => ({ id: a.id, fileName: a.file_name, mimeType: a.mime_type, fileSize: Number(a.file_size) })),
  };
}

async function withAttachments(q: Q, rows: MsgRow[]): Promise<ChatMessage[]> {
  if (rows.length === 0) return [];
  const atts = await q<AttRow[]>`
    select id, message_id, file_name, mime_type, file_size from order_message_attachments
    where message_id in ${q(rows.map((r) => r.id))} order by created_at asc, id asc`;
  return rows.map((r) => toMessage(r, atts));
}

/** Pesan dengan seq > afterSeq (kursor polling). Satu query terindeks (order_id, seq) bila tidak ada pesan baru. */
export async function listMessages(orderId: string, afterSeq: number, limit = 100): Promise<ChatMessage[]> {
  const rows = await sql()<MsgRow[]>`
    select id, seq::int as seq, sender_kind, sender_name, body, created_at from order_messages
    where order_id = ${orderId} and seq > ${afterSeq} order by seq asc limit ${limit}`;
  return withAttachments(sql(), rows);
}

export async function findMessageByRequestKey(orderId: string, requestKey: string): Promise<ChatMessage | null> {
  const rows = await sql()<MsgRow[]>`
    select id, seq::int as seq, sender_kind, sender_name, body, created_at from order_messages
    where order_id = ${orderId} and request_key = ${requestKey}`;
  return (await withAttachments(sql(), rows))[0] ?? null;
}

export async function getLastSeq(orderId: string): Promise<number> {
  const [r] = await sql()<{ s: number }[]>`select coalesce(max(seq), 0)::int as s from order_messages where order_id = ${orderId}`;
  return r.s;
}

export async function countMessageAttachments(orderId: string): Promise<number> {
  const [r] = await sql()<{ n: number }[]>`select count(*)::int as n from order_message_attachments where order_id = ${orderId}`;
  return r.n;
}

export async function insertMessage(input: {
  orderId: string;
  sender: MessageSender;
  body: string;
  requestKey: string | null;
  attachments: NewMessageAttachment[];
}): Promise<{ message: ChatMessage; duplicate: boolean }> {
  try {
    const message = await sql().begin(async (tx) => {
      const [m] = await tx<MsgRow[]>`
        insert into order_messages (order_id, sender_kind, sender_name, sender_user_id, body, request_key)
        values (${input.orderId}, ${input.sender.kind}, ${input.sender.name}, ${input.sender.userId}, ${input.body}, ${input.requestKey})
        returning id, seq::int as seq, sender_kind, sender_name, body, created_at`;
      for (const a of input.attachments) {
        await tx`
          insert into order_message_attachments (message_id, order_id, file_name, storage_path, mime_type, file_size)
          values (${m.id}, ${input.orderId}, ${a.fileName}, ${a.storagePath}, ${a.mimeType}, ${a.fileSize})`;
      }
      return (await withAttachments(tx, [m]))[0];
    });
    return { message, duplicate: false };
  } catch (error) {
    // Kiriman ulang dengan requestKey yang sama (klik ganda / ulang jaringan): kembalikan pesan yang sudah ada.
    if (input.requestKey && pgErrorCode(error) === "23505" && pgConstraint(error) === "order_messages_request_key_uq") {
      const existing = await findMessageByRequestKey(input.orderId, input.requestKey);
      if (existing) return { message: existing, duplicate: true };
    }
    throw error;
  }
}

export async function getMessageAttachment(id: string) {
  const [r] = await sql()<{ id: string; order_id: string; file_name: string; storage_path: string; mime_type: string; file_size: number }[]>`
    select id, order_id, file_name, storage_path, mime_type, file_size from order_message_attachments where id = ${id}`;
  return r ?? null;
}

// ---------------------------------------------------------------- status baca

export async function getReadState(orderId: string, reader: Reader): Promise<{ lastReadSeq: number; resultsSeenAt: Date | null }> {
  const [r] = await sql()<{ last_read_seq: number; results_seen_at: Date | null }[]>`
    select last_read_seq::int as last_read_seq, results_seen_at from order_read_state
    where order_id = ${orderId} and reader_kind = ${reader.kind} and reader_key = ${reader.key}`;
  return { lastReadSeq: r?.last_read_seq ?? 0, resultsSeenAt: r?.results_seen_at ?? null };
}

export async function countUnread(orderId: string, viewer: SenderKind, lastReadSeq: number): Promise<number> {
  const [r] = await sql()<{ n: number }[]>`
    select count(*)::int as n from order_messages where order_id = ${orderId} and seq > ${lastReadSeq} and sender_kind <> ${viewer}`;
  return r.n;
}

/** Kursor baca tidak pernah mundur dan tidak pernah melewati pesan yang benar-benar ada. */
export async function markRead(orderId: string, reader: Reader, upToSeq: number): Promise<number> {
  const [r] = await sql()<{ s: number }[]>`
    insert into order_read_state (order_id, reader_kind, reader_key, last_read_seq)
    values (${orderId}, ${reader.kind}, ${reader.key}, least(${upToSeq}, (select coalesce(max(seq), 0) from order_messages where order_id = ${orderId})))
    on conflict (order_id, reader_kind, reader_key) do update
      set last_read_seq = greatest(order_read_state.last_read_seq, excluded.last_read_seq), updated_at = now()
    returning last_read_seq::int as s`;
  return r.s;
}

export async function markResultsSeen(orderId: string, reader: Reader): Promise<void> {
  await sql()`
    insert into order_read_state (order_id, reader_kind, reader_key, results_seen_at) values (${orderId}, ${reader.kind}, ${reader.key}, now())
    on conflict (order_id, reader_kind, reader_key) do update set results_seen_at = now(), updated_at = now()`;
}

/** Penanda perhatian untuk banyak nomor order sekaligus — SATU query, hanya angka/flag kecil. */
export async function getBadges(orderNumbers: string[]): Promise<OrderBadges[]> {
  if (orderNumbers.length === 0) return [];
  const rows = await sql()<{
    order_number: string; status: string; unread: number; awaiting_deadline: boolean; new_results: number; clar: boolean; brief_pending: boolean;
  }[]>`
    select o.order_number, o.status,
      (select count(*)::int from order_messages m
        where m.order_id = o.id and m.sender_kind <> 'requester'
          and m.seq > coalesce((select rs.last_read_seq from order_read_state rs where rs.order_id = o.id and rs.reader_kind = 'requester' and rs.reader_key = ''), 0)) as unread,
      (o.status not in ('completed', 'cancelled') and (
         (o.deadline_agreement_status = 'awaiting_requester' and o.pic_estimated_deadline is not null)
         or (o.deadline_agreement_status = 'agreed' and coalesce((
              select e.kind from order_deadline_events e
              where e.order_id = o.id and e.kind in ('change_proposed', 'change_approved', 'change_rejected', 'admin_changed', 'manager_resolved')
              order by e.created_at desc, e.id desc limit 1), '') = 'change_proposed')
      )) as awaiting_deadline,
      (select count(*)::int from order_workflow_events e
        where e.order_id = o.id and e.kind = 'delivery_recorded'
          and e.created_at > coalesce((select rs.results_seen_at from order_read_state rs where rs.order_id = o.id and rs.reader_kind = 'requester' and rs.reader_key = ''), '-infinity'::timestamptz)) as new_results,
      (o.status not in ('completed', 'cancelled') and exists (select 1 from review_annotations a where a.order_id = o.id and a.status = 'waiting_clarification')) as clar,
      exists (select 1 from order_brief_change_requests c where c.order_id = o.id and c.status = 'pending') as brief_pending
    from orders o where o.order_number in ${sql()(orderNumbers)}`;
  return rows.map((r) => ({
    orderNumber: r.order_number,
    status: r.status,
    unreadMessages: r.unread,
    awaitingDeadline: r.awaiting_deadline,
    newResults: r.new_results,
    awaitingClarification: r.clar,
    briefChangePending: r.brief_pending,
  }));
}

// ---------------------------------------------------------------- brief

export type OrderBriefSummary = {
  orderNumber: string;
  title: string;
  requesterName: string;
  department: string;
  brandName: string;
  designType: string;
  designSize: string;
  priority: string;
  driveUrl: string | null;
  createdAt: string;
  requestedDeadline: string;
  agreedDeadline: string | null;
  status: OrderStatus;
  brief: string;
  briefRich: RichDoc | null;
};

export async function getBriefSummary(orderId: string): Promise<OrderBriefSummary> {
  const [o] = await sql()<{
    order_number: string; title: string; requester_name: string; department: string; brand_name: string; design_type: string;
    design_size: string; priority: string; drive_url: string | null; created_at: Date; deadline_at: Date; requested_deadline: Date | null;
    agreed_deadline: Date | null; status: OrderStatus; brief: string; brief_rich: RichDoc | null;
  }[]>`
    select o.order_number, o.title, o.requester_name, o.department, b.name as brand_name, o.design_type, o.design_size, o.priority,
           o.drive_url, o.created_at, o.deadline_at, o.requested_deadline, o.agreed_deadline, o.status, o.brief, o.brief_rich
    from orders o join brands b on b.id = o.brand_id where o.id = ${orderId}`;
  if (!o) throw new NotFoundError("Order tidak ditemukan.");
  return {
    orderNumber: o.order_number,
    title: o.title,
    requesterName: o.requester_name,
    department: o.department,
    brandName: o.brand_name,
    designType: o.design_type,
    designSize: o.design_size,
    priority: o.priority,
    driveUrl: o.drive_url,
    createdAt: o.created_at.toISOString(),
    requestedDeadline: (o.requested_deadline ?? o.deadline_at).toISOString(),
    agreedDeadline: o.agreed_deadline?.toISOString() ?? null,
    status: o.status,
    brief: o.brief,
    briefRich: o.brief_rich,
  };
}

export async function listBriefVersions(orderId: string): Promise<BriefVersion[]> {
  const rows = await sql()<{ version_no: number; brief: string; brief_rich: RichDoc | null; source: BriefVersion["source"]; created_by_name: string; created_at: Date }[]>`
    select version_no, brief, brief_rich, source, created_by_name, created_at from order_brief_versions
    where order_id = ${orderId} order by version_no desc limit 50`;
  return rows.map((r) => ({ versionNo: r.version_no, brief: r.brief, briefRich: r.brief_rich, source: r.source, createdByName: r.created_by_name, createdAt: r.created_at.toISOString() }));
}

type ChangeRow = {
  id: string; based_on_version: number; proposed_brief: string; proposed_brief_rich: RichDoc | null; reason: string; requested_by_name: string;
  status: BriefChangeStatus; decided_by_name: string | null; decided_at: Date | null; decision_note: string | null; resulting_version_no: number | null; created_at: Date;
};
const toChange = (r: ChangeRow): BriefChange => ({
  id: r.id,
  basedOnVersion: r.based_on_version,
  proposedBrief: r.proposed_brief,
  proposedBriefRich: r.proposed_brief_rich,
  reason: r.reason,
  requestedByName: r.requested_by_name,
  status: r.status,
  decidedByName: r.decided_by_name,
  decidedAt: r.decided_at?.toISOString() ?? null,
  decisionNote: r.decision_note,
  resultingVersionNo: r.resulting_version_no,
  createdAt: r.created_at.toISOString(),
});

export async function listBriefChanges(orderId: string): Promise<BriefChange[]> {
  const rows = await sql()<ChangeRow[]>`
    select id, based_on_version, proposed_brief, proposed_brief_rich, reason, requested_by_name, status, decided_by_name, decided_at,
           decision_note, resulting_version_no, created_at
    from order_brief_change_requests where order_id = ${orderId} order by created_at desc, id desc limit 50`;
  return rows.map(toChange);
}

async function insertEvent(q: Q, orderId: string, kind: string, actorName: string, actorUserId: string | null, summary: string, detail: Record<string, unknown>) {
  await q`
    insert into order_workflow_events (order_id, kind, actor_user_id, actor_name, summary, detail)
    values (${orderId}, ${kind}, ${actorUserId}, ${actorName}, ${summary.slice(0, 1000)}, ${q.json(detail as postgres.JSONValue)})`;
}

async function lockOpenOrder(tx: postgres.TransactionSql, orderId: string): Promise<{ status: OrderStatus; brief: string }> {
  const [o] = await tx<{ status: OrderStatus; brief: string }[]>`select status, brief from orders where id = ${orderId} for update`;
  if (!o) throw new NotFoundError("Order tidak ditemukan.");
  if (FINISHED_STATUSES.includes(o.status)) throw new AppError("Pekerjaan sudah selesai atau dibatalkan; brief tidak dapat diubah lagi.", 409);
  return o;
}

/** Pemohon mengusulkan perubahan brief. Brief asli TIDAK berubah; hanya PIC/Manager/Admin yang dapat menerima. */
export async function createBriefChange(input: {
  orderId: string;
  proposed: { doc: RichDoc; text: string };
  reason: string;
  requestedByName: string;
  requestKey: string | null;
}): Promise<{ change: BriefChange; duplicate: boolean }> {
  try {
    return await sql().begin(async (tx) => {
      const cur = await lockOpenOrder(tx, input.orderId);
      if (input.requestKey) {
        const [dup] = await tx<ChangeRow[]>`
          select id, based_on_version, proposed_brief, proposed_brief_rich, reason, requested_by_name, status, decided_by_name, decided_at,
                 decision_note, resulting_version_no, created_at
          from order_brief_change_requests where order_id = ${input.orderId} and request_key = ${input.requestKey}`;
        if (dup) return { change: toChange(dup), duplicate: true };
      }
      const problem = briefChangeProblem(input.reason, input.proposed.text, cur.brief);
      if (problem) throw new AppError(problem.message, 422, { [problem.field]: problem.message });
      const [pending] = await tx`select 1 from order_brief_change_requests where order_id = ${input.orderId} and status = 'pending'`;
      if (pending) throw new AppError("Masih ada usulan perubahan brief yang menunggu keputusan PIC. Tarik usulan itu dulu bila ingin menggantinya.", 409);
      const [v] = await tx<{ n: number }[]>`select coalesce(max(version_no), 1) as n from order_brief_versions where order_id = ${input.orderId}`;
      const [row] = await tx<ChangeRow[]>`
        insert into order_brief_change_requests (order_id, based_on_version, proposed_brief, proposed_brief_rich, reason, requested_by_name, request_key)
        values (${input.orderId}, ${v.n}, ${input.proposed.text}, ${tx.json(input.proposed.doc as unknown as postgres.JSONValue)}, ${input.reason.trim()}, ${input.requestedByName}, ${input.requestKey})
        returning id, based_on_version, proposed_brief, proposed_brief_rich, reason, requested_by_name, status, decided_by_name, decided_at,
                  decision_note, resulting_version_no, created_at`;
      await insertEvent(tx, input.orderId, "brief_change_requested", input.requestedByName, null, "Pemohon mengusulkan perubahan brief", { changeId: row.id, basedOnVersion: v.n, reason: input.reason.trim().slice(0, 300) });
      return { change: toChange(row), duplicate: false };
    });
  } catch (error) {
    if (pgErrorCode(error) === "23505" && pgConstraint(error) === "order_brief_change_one_pending_uq")
      throw new AppError("Masih ada usulan perubahan brief yang menunggu keputusan PIC. Tarik usulan itu dulu bila ingin menggantinya.", 409);
    throw error;
  }
}

export async function withdrawBriefChange(orderId: string, changeId: string, requestedByName: string): Promise<void> {
  await sql().begin(async (tx) => {
    await lockOpenOrder(tx, orderId);
    const rows = await tx`
      update order_brief_change_requests set status = 'withdrawn', decided_at = now(), decided_by_name = ${requestedByName}
      where id = ${changeId} and order_id = ${orderId} and status = 'pending' returning id`;
    if (rows.length === 0) throw new AppError("Usulan tidak ditemukan atau sudah diputuskan.", 409);
    await insertEvent(tx, orderId, "brief_change_withdrawn", requestedByName, null, "Pemohon menarik usulan perubahan brief", { changeId });
  });
}

/** PIC/Manager/Admin menerima atau menolak usulan. Menerima = brief order diperbarui + versi baru + riwayat. */
export async function decideBriefChange(input: {
  orderId: string;
  changeId: string;
  decision: "accept" | "reject";
  note: string | null;
  actor: { name: string; userId: string };
}): Promise<{ change: BriefChange }> {
  return sql().begin(async (tx) => {
    await lockOpenOrder(tx, input.orderId);
    const [c] = await tx<(ChangeRow & { order_id: string })[]>`
      select id, order_id, based_on_version, proposed_brief, proposed_brief_rich, reason, requested_by_name, status, decided_by_name, decided_at,
             decision_note, resulting_version_no, created_at
      from order_brief_change_requests where id = ${input.changeId} and order_id = ${input.orderId} for update`;
    if (!c) throw new NotFoundError("Usulan perubahan tidak ditemukan.");
    if (c.status !== "pending") throw new AppError("Usulan ini sudah diputuskan atau ditarik.", 409);

    let resulting: number | null = null;
    if (input.decision === "accept") {
      const [v] = await tx<{ n: number }[]>`select coalesce(max(version_no), 1) as n from order_brief_versions where order_id = ${input.orderId}`;
      if (v.n > c.based_on_version)
        throw new AppError("Brief sudah berubah setelah usulan ini dibuat. Minta Pemohon mengajukan ulang usulan berdasarkan versi terbaru.", 409);
      await tx`select set_config('dtic.brief_source', 'requester_change', true)`;
      await tx`select set_config('dtic.brief_change_id', ${c.id}, true)`;
      await tx`select set_config('dtic.brief_actor', ${`${c.requested_by_name} (usulan diterima oleh ${input.actor.name})`}, true)`;
      await tx`update orders set brief = ${c.proposed_brief}, brief_rich = ${tx.json(c.proposed_brief_rich as unknown as postgres.JSONValue)} where id = ${input.orderId}`;
      const [nv] = await tx<{ n: number }[]>`select max(version_no) as n from order_brief_versions where order_id = ${input.orderId}`;
      resulting = nv.n;
    } else if (!input.note || input.note.trim().length < 3) {
      throw new AppError("Alasan penolakan wajib diisi.", 422, { note: "Alasan penolakan wajib diisi." });
    }

    const [row] = await tx<ChangeRow[]>`
      update order_brief_change_requests
      set status = ${input.decision === "accept" ? "accepted" : "rejected"}, decided_by_name = ${input.actor.name}, decided_by_user_id = ${input.actor.userId},
          decided_at = now(), decision_note = ${input.note?.trim() || null}, resulting_version_no = ${resulting}
      where id = ${c.id}
      returning id, based_on_version, proposed_brief, proposed_brief_rich, reason, requested_by_name, status, decided_by_name, decided_at,
                decision_note, resulting_version_no, created_at`;
    await insertEvent(
      tx,
      input.orderId,
      input.decision === "accept" ? "brief_change_accepted" : "brief_change_rejected",
      input.actor.name,
      input.actor.userId,
      input.decision === "accept" ? `Perubahan brief diterima (versi ${resulting})` : "Perubahan brief ditolak",
      { changeId: c.id, resultingVersionNo: resulting, note: input.note?.trim().slice(0, 300) ?? null },
    );
    return { change: toChange(row) };
  });
}

// ---------------------------------------------------------------- referensi

export async function listReferences(orderId: string): Promise<ReferenceFile[]> {
  const rows = await sql()<{ id: string; file_name: string; mime_type: string; file_size: number; created_at: Date; added_after_submission: boolean; uploaded_by_name: string | null }[]>`
    select id, file_name, mime_type, file_size, created_at, added_after_submission, uploaded_by_name from order_attachments
    where order_id = ${orderId} and kind = 'reference' order by created_at asc, id asc`;
  return rows.map((r) => ({ id: r.id, fileName: r.file_name, mimeType: r.mime_type, fileSize: Number(r.file_size), createdAt: r.created_at.toISOString(), addedLater: r.added_after_submission, uploadedByName: r.uploaded_by_name }));
}

export async function countLateReferences(orderId: string): Promise<number> {
  const [r] = await sql()<{ n: number }[]>`select count(*)::int as n from order_attachments where order_id = ${orderId} and kind = 'reference' and added_after_submission`;
  return r.n;
}

export async function insertLateReferences(orderId: string, files: NewMessageAttachment[], uploaderName: string): Promise<void> {
  await sql().begin(async (tx) => {
    await lockOpenOrder(tx, orderId);
    for (const f of files) {
      await tx`
        insert into order_attachments (order_id, file_name, storage_path, mime_type, file_size, kind, added_after_submission, uploaded_by_name)
        values (${orderId}, ${f.fileName}, ${f.storagePath}, ${f.mimeType}, ${f.fileSize}, 'reference', true, ${uploaderName})`;
    }
    await insertEvent(tx, orderId, "reference_uploaded", uploaderName, null, `Pemohon menambahkan ${files.length} berkas referensi`, { count: files.length, names: files.map((f) => f.fileName).slice(0, 10) });
  });
}

export async function getReferenceFile(orderId: string, fileId: string) {
  const [r] = await sql()<{ id: string; file_name: string; storage_path: string | null; mime_type: string; file_size: number }[]>`
    select id, file_name, storage_path, mime_type, file_size from order_attachments where id = ${fileId} and order_id = ${orderId} and kind = 'reference'`;
  return r ?? null;
}

// ---------------------------------------------------------------- aktivitas (Pemohon)

const DEADLINE_LABEL: Record<string, string> = {
  pic_accepted_requested: "PIC menyetujui waktu yang Anda minta",
  pic_proposed: "PIC mengusulkan waktu pengerjaan",
  requester_approved: "Pemohon menyetujui waktu pengerjaan",
  requester_adjustment_requested: "Pemohon meminta penyesuaian waktu",
  escalated: "Kesepakatan waktu dieskalasi ke Manager",
  manager_resolved: "Manager menetapkan deadline final",
  admin_changed: "Admin mengubah deadline final",
  change_proposed: "PIC mengusulkan perubahan deadline",
  change_approved: "Pemohon menyetujui perubahan deadline",
  change_rejected: "Pemohon menolak perubahan deadline",
};

/** Label peristiwa alur kerja yang aman dipublikasikan. Kind lain (QC internal, SLA, highlight) sengaja tidak tampil. */
const PUBLIC_EVENT_LABEL: Record<string, { label: string; kind: ActivityItem["kind"]; actorIsPemohon?: boolean }> = {
  reference_uploaded: { label: "Pemohon menambahkan berkas referensi", kind: "reference", actorIsPemohon: true },
  brief_change_requested: { label: "Pemohon mengusulkan perubahan brief", kind: "brief_change", actorIsPemohon: true },
  brief_change_accepted: { label: "Perubahan brief diterima", kind: "brief_change" },
  brief_change_rejected: { label: "Perubahan brief ditolak", kind: "brief_change" },
  brief_change_withdrawn: { label: "Pemohon menarik usulan perubahan brief", kind: "brief_change", actorIsPemohon: true },
  revision_created: { label: "Request Revisi diajukan", kind: "review", actorIsPemohon: true },
  revision_started: { label: "PIC mulai mengerjakan revisi", kind: "review" },
  revision_delivered: { label: "PIC menyerahkan hasil revisi", kind: "review" },
  revision_approved: { label: "Pemohon menyetujui hasil revisi", kind: "review", actorIsPemohon: true },
  revision_resubmitted: { label: "Revisi diajukan kembali", kind: "review", actorIsPemohon: true },
  review_clarification_requested: { label: "PIC meminta klarifikasi", kind: "review" },
  review_clarification_answered: { label: "Pemohon menjawab klarifikasi", kind: "review", actorIsPemohon: true },
  completed: { label: "Pekerjaan diselesaikan", kind: "status" },
};

export async function getRequesterActivity(orderId: string): Promise<ActivityItem[]> {
  const db = sql();
  const [order, assignments, history, deadlines, events, msgs, feedback] = await Promise.all([
    db<{ created_at: Date; requester_name: string }[]>`select created_at, requester_name from orders where id = ${orderId}`,
    db<{ assigned_at: Date; full_name: string }[]>`
      select a.assigned_at, m.full_name from order_assignments a join dtic_members m on m.id = a.member_id where a.order_id = ${orderId}`,
    db<{ id: string; new_status: string; changed_at: Date }[]>`
      select id, new_status, changed_at from order_status_history where order_id = ${orderId} and previous_status is not null order by changed_at asc limit 100`,
    db<{ id: string; kind: string; proposed_deadline: Date | null; reason: string | null; actor_name: string | null; created_at: Date }[]>`
      select id, kind, proposed_deadline, reason, actor_name, created_at from order_deadline_events where order_id = ${orderId} order by created_at asc limit 100`,
    db<{ id: string; kind: string; actor_name: string | null; summary: string | null; created_at: Date; detail: Record<string, unknown> }[]>`
      select id, kind, actor_name, summary, created_at, detail from order_workflow_events
      where order_id = ${orderId} and kind in ${db(Object.keys(PUBLIC_EVENT_LABEL))} order by created_at asc limit 200`,
    db<(MsgRow & { files: number })[]>`
      select m.id, m.seq::int as seq, m.sender_kind, m.sender_name, '' as body, m.created_at,
             (select count(*)::int from order_message_attachments a where a.message_id = m.id) as files
      from order_messages m where m.order_id = ${orderId} order by m.seq asc limit 500`,
    db<{ id: string; created_at: Date; needs_revision: boolean | null }[]>`
      select id, created_at, needs_revision from order_workflow_events where order_id = ${orderId} and kind = 'feedback_recorded' order by created_at asc limit 100`,
  ]);
  const deliveries = await db<{ id: string; created_at: Date }[]>`
    select id, created_at from order_workflow_events where order_id = ${orderId} and kind = 'delivery_recorded' order by created_at asc, id asc limit 100`;

  const items: ActivityItem[] = [];
  const o = order[0];
  if (o) items.push({ key: "created", at: o.created_at.toISOString(), kind: "created", label: "Request dikirim", actor: "Pemohon", detail: null });
  for (const a of assignments) items.push({ key: `assign-${a.full_name}-${a.assigned_at.toISOString()}`, at: a.assigned_at.toISOString(), kind: "assigned", label: `${a.full_name} ditugaskan sebagai PIC`, actor: null, detail: null });
  for (const h of history) {
    const s = toCurrentStatus(h.new_status);
    if (s) items.push({ key: `st-${h.id}`, at: h.changed_at.toISOString(), kind: "status", label: `Status berubah: ${clientStatusLabel(s, false).label}`, actor: null, detail: null });
  }
  for (const d of deadlines) {
    const base = DEADLINE_LABEL[d.kind] ?? "Kesepakatan waktu diperbarui";
    items.push({ key: `dl-${d.id}`, at: d.created_at.toISOString(), kind: "deadline", label: base, actor: d.actor_name, detail: d.reason });
  }
  for (const e of events) {
    const def = PUBLIC_EVENT_LABEL[e.kind];
    if (!def) continue;
    const detail = e.kind === "brief_change_requested" && typeof e.detail?.reason === "string" ? (e.detail.reason as string) : null;
    items.push({ key: `ev-${e.id}`, at: e.created_at.toISOString(), kind: def.kind, label: def.label, actor: def.actorIsPemohon ? "Pemohon" : e.actor_name, detail });
  }
  deliveries.forEach((d, i) => items.push({ key: `dv-${d.id}`, at: d.created_at.toISOString(), kind: "delivery", label: `PIC mengajukan hasil (Pengajuan #${i + 1})`, actor: null, detail: null }));
  for (const f of feedback)
    items.push({ key: `fb-${f.id}`, at: f.created_at.toISOString(), kind: "decision", label: f.needs_revision === false ? "Pemohon menyetujui hasil" : "Pemohon meminta revisi hasil", actor: "Pemohon", detail: null });
  items.push(
    ...groupMessageActivity(
      msgs.map((m) => ({ id: m.id, senderKind: m.sender_kind, senderName: m.sender_name, createdAt: m.created_at.toISOString(), attachments: Array.from({ length: m.files }, (_, i) => ({ id: `${m.id}-${i}`, fileName: "", mimeType: "", fileSize: 0 })) })),
    ),
  );
  return sortActivity(items);
}
