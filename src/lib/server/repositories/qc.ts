import "server-only";
import type postgres from "postgres";
import type { Role } from "@/lib/auth/permissions";
import { checkWorkflowAction, handoverProblem, type DeliveryStatus, type HandoverChannel, type QcContext, type QcStatus, type WorkflowEventKind } from "@/lib/qc";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { enqueueOrderNotification } from "@/lib/server/repositories/notifications";
import type { OrderStatus } from "@/lib/status";
import { eventTypeForStatus } from "@/lib/telegram-routing";
import { assertResultFiles, assertResultLinks, moveResultFilesToCategory } from "@/lib/server/repositories/results";
import type { ResultCategory } from "@/lib/drive";
import type { WorkflowActionInput } from "@/lib/validation/workflow";

export type QcActorInfo = { userId: string; name: string; role: Role; memberId: string | null };

export type WorkflowEvent = {
  id: string;
  kind: WorkflowEventKind;
  at: string;
  actorName: string | null;
  stage: string | null;
  link: string | null;
  summary: string | null;
  needsRevision: boolean | null;
  detail: Record<string, unknown>;
};

/**
 * Waktu pengajuan QC PERTAMA kali untuk order ini (atau null bila belum pernah diajukan sama sekali) —
 * acuan tanggal folder arsip Drive (lihat driveResultFolderPath): folder dibuat berdasarkan kapan hasil
 * pertama kali diserahkan untuk QC, bukan kapan order dibuat.
 */
export async function firstQcSubmittedAt(orderId: string): Promise<Date | null> {
  const [r] = await sql()<{ created_at: Date }[]>`
    select created_at from order_workflow_events where order_id = ${orderId} and kind = 'qc_submitted' order by created_at asc limit 1`;
  return r?.created_at ?? null;
}

export async function getQcStatus(orderId: string): Promise<QcStatus | null> {
  const [r] = await sql()<{ qc_status: QcStatus }[]>`select qc_status from orders where id = ${orderId}`;
  return r?.qc_status ?? null;
}

/** Nama Manager aktif (penerima pengajuan QC). Pengajuan ditujukan ke peran Manager, bukan satu orang tertentu. */
export async function listActiveManagerNames(): Promise<string[]> {
  const rows = await sql()<{ full_name: string }[]>`select full_name from app_users where role = 'manager' and is_active order by full_name`;
  return rows.map((r) => r.full_name);
}

/** Jejak penyerahan hasil, QC, masukan pemohon, dan penyelesaian; terbaru dulu. */
export async function listWorkflowEvents(orderId: string): Promise<WorkflowEvent[]> {
  const rows = await sql()<{
    id: string; kind: WorkflowEventKind; created_at: Date; actor_name: string | null; stage: string | null; link: string | null;
    summary: string | null; needs_revision: boolean | null; detail: Record<string, unknown>;
  }[]>`
    select e.id, e.kind, e.created_at, coalesce(e.actor_name, u.full_name) as actor_name, e.stage, e.link, e.summary, e.needs_revision, e.detail
    from order_workflow_events e left join app_users u on u.id = e.actor_user_id
    where e.order_id = ${orderId}
    order by e.created_at desc, e.id desc
    limit 100`;
  return rows.map((r) => ({ id: r.id, kind: r.kind, at: r.created_at.toISOString(), actorName: r.actor_name, stage: r.stage, link: r.link, summary: r.summary, needsRevision: r.needs_revision, detail: r.detail ?? {} }));
}

export type QcHistoryEntry = {
  id: string;
  orderId: string;
  orderNumber: string;
  orderTitle: string;
  kind: "qc_approved" | "qc_revision_requested" | "qc_access_requested";
  at: string;
  actorName: string | null;
  summary: string | null;
};

/**
 * Riwayat KEPUTUSAN QC lintas-order (Setujui/Minta Revisi/Minta Akses) — bukan seluruh peristiwa workflow
 * (lihat listWorkflowEvents untuk riwayat lengkap SATU order). Dipakai tab "Riwayat QC" Manager. Tidak ada
 * tabel baru: membaca order_workflow_events yang sudah ada, hanya kind keputusan QC.
 */
export async function listQcHistory(limit = 100): Promise<QcHistoryEntry[]> {
  const rows = await sql()<
    { id: string; order_id: string; order_number: string; title: string; kind: "qc_approved" | "qc_revision_requested" | "qc_access_requested"; created_at: Date; actor_name: string | null; summary: string | null }[]
  >`
    select e.id, e.order_id, o.order_number, o.title, e.kind, e.created_at, coalesce(e.actor_name, u.full_name) as actor_name, e.summary
    from order_workflow_events e
    join orders o on o.id = e.order_id
    left join app_users u on u.id = e.actor_user_id
    where e.kind in ('qc_approved', 'qc_revision_requested', 'qc_access_requested')
    order by e.created_at desc, e.id desc
    limit ${limit}`;
  return rows.map((r) => ({ id: r.id, orderId: r.order_id, orderNumber: r.order_number, orderTitle: r.title, kind: r.kind, at: r.created_at.toISOString(), actorName: r.actor_name, summary: r.summary }));
}

/** Status pengiriman dari peristiwa terbaru (tidak disimpan ganda). */
export function deliveryStatusOf(events: WorkflowEvent[]): DeliveryStatus {
  const d = events.find((e) => e.kind === "delivery_recorded");
  if (!d) return "none";
  return d.detail.afterQc === true ? "after_qc" : "direct";
}

export type WorkflowResult = { changed: boolean; duplicate: boolean; status: OrderStatus; outboxId: string | null; notification?: "enqueue_failed" };

const SENT_AT_FUTURE_MS = 5 * 60_000;

/**
 * Terapkan satu aksi. Order dikunci (for update): permintaan bersamaan diserialkan, yang kedua ditolak karena
 * status sudah berubah (tidak ada persetujuan/penyelesaian ganda). Permintaan ulang dengan requestKey yang sama
 * (klik ganda, retry setelah timeout) mengembalikan hasil tanpa membuat peristiwa atau notifikasi baru.
 */
export async function applyWorkflowAction(orderId: string, input: WorkflowActionInput, actor: QcActorInfo): Promise<WorkflowResult> {
  // Dipindahkan ke kategori folder Drive yang sesuai SETELAH transaksi berhasil (tidak menahan transaksi
  // database untuk memanggil Drive — pola yang sama dengan sinkronisasi unggah hasil). Kegagalan Drive di
  // sini tidak pernah membatalkan aksi QC yang sudah sah tersimpan (lihat moveResultFilesToCategory).
  // (Dikembalikan dari dalam transaksi, bukan lewat variabel luar yang diubah di dalam closure — TypeScript
  // tidak melacak penugasan di dalam closure async untuk narrowing di luar, lihat pembahasan di PR.)
  type DriveMove = { fileIds: string[]; category: ResultCategory; revisionNumber?: number };
  const { driveMove, ...result } = await sql().begin(async (tx) => {
    let driveMove: DriveMove | null = null;
    const [o] = await tx<{ status: OrderStatus; qc_status: QcStatus }[]>`select status, qc_status from orders where id = ${orderId} for update`;
    if (!o) throw new NotFoundError("Order tidak ditemukan.");
    if (input.requestKey) {
      const dup = await tx`select 1 from order_workflow_events where order_id = ${orderId} and request_key = ${input.requestKey}`;
      if (dup.length > 0) return { changed: false, duplicate: true, status: o.status, outboxId: null, driveMove };
    }

    const assignees = (await tx<{ member_id: string }[]>`select member_id from order_assignments where order_id = ${orderId}`).map((r) => r.member_id);
    const isAssignee = !!actor.memberId && assignees.includes(actor.memberId);
    const ctx: QcContext = { status: o.status, qcStatus: o.qc_status };
    const note = input.note ?? null;
    const check = checkWorkflowAction({ action: input.action, ctx, actor: { role: actor.role, isAssignee }, note, confirmSent: input.action === "record_delivery" ? input.confirmSent : undefined });
    if (!check.ok) throw new AppError(check.message, check.status, check.field ? { [check.field]: check.message } : undefined);
    if (input.action === "record_delivery" && input.sentAt && new Date(input.sentAt).getTime() > Date.now() + SENT_AT_FUTURE_MS) {
      throw new AppError("Waktu pengiriman tidak boleh di masa depan.", 422, { sentAt: "Waktu pengiriman tidak boleh di masa depan." });
    }

    const fileIds = "resultFileIds" in input && input.resultFileIds ? [...new Set(input.resultFileIds)] : [];
    const linkIds = "resultLinkIds" in input && input.resultLinkIds ? [...new Set(input.resultLinkIds)] : [];
    await assertResultFiles(tx, orderId, fileIds);
    await assertResultLinks(tx, orderId, linkIds);
    if (input.action === "submit_qc") {
      const problem = handoverProblem({ method: input.method, fileCount: fileIds.length, resultLinkCount: linkIds.length, channel: input.channel, note });
      if (problem) throw new AppError(problem.message, 422, { [problem.field]: problem.message });
      if (input.handedAt && new Date(input.handedAt).getTime() > Date.now() + SENT_AT_FUTURE_MS) {
        throw new AppError("Waktu penyerahan tidak boleh di masa depan.", 422, { handedAt: "Waktu penyerahan tidak boleh di masa depan." });
      }
    }

    let to: OrderStatus = o.status;
    let qc: QcStatus = o.qc_status;
    let kind: WorkflowEventKind;
    let notify = false;
    let ev: { stage?: string | null; link?: string | null; needsRevision?: boolean | null; detail?: Record<string, unknown> } = {};

    switch (input.action) {
      case "submit_qc":
        to = "pending_confirmation"; qc = "pending"; kind = "qc_submitted"; notify = true;
        ev = {
          stage: input.stage ?? null,
          link: input.link,
          detail:
            input.method === "external"
              // Klaim PIC: dicatat apa adanya. handedAt hanya bila diisi (tidak dikarang); waktu pencatatan = created_at.
              ? { method: "external", channel: input.channel, recipient: input.recipient, handedAt: input.handedAt ?? null, resultFileIds: fileIds, resultLinkIds: linkIds }
              // method in_app = diserahkan lewat DTIC Nexus — "dtic_nexus" DICATAT SISTEM, bukan dipilih
              // PIC (lihat SELECTABLE_HANDOVER_CHANNELS); input.channel diabaikan di jalur ini.
              : { method: "in_app", channel: "dtic_nexus" satisfies HandoverChannel, handedAt: input.handedAt ?? null, resultFileIds: fileIds, resultLinkIds: linkIds },
        };
        if (fileIds.length > 0) {
          // Pengajuan pertama (belum pernah diminta revisi) → Hasil Awal; setelah revisi diminta N kali →
          // Revisi-NN (N = jumlah 'qc_revision_requested' SEBELUM pengajuan ini).
          const [{ c: revisionCount }] = await tx<{ c: number }[]>`
            select count(*)::int as c from order_workflow_events where order_id = ${orderId} and kind = 'qc_revision_requested'`;
          driveMove = revisionCount === 0 ? { fileIds, category: "hasil_awal" } : { fileIds, category: "revisi", revisionNumber: revisionCount };
        }
        break;
      case "withdraw_qc":
        to = "in_progress"; qc = "none"; kind = "qc_withdrawn";
        break;
      case "approve_qc":
        to = "in_progress"; qc = "approved"; kind = "qc_approved"; notify = true;
        {
          // Persetujuan berlaku untuk versi yang diajukan terakhir (file & tautan yang sama).
          const [sub] = await tx<{ link: string | null; detail: Record<string, unknown> }[]>`
            select link, detail from order_workflow_events where order_id = ${orderId} and kind = 'qc_submitted' order by created_at desc, id desc limit 1`;
          const approvedFileIds = Array.isArray(sub?.detail?.resultFileIds) ? (sub.detail.resultFileIds as string[]) : [];
          const approvedLinkIds = Array.isArray(sub?.detail?.resultLinkIds) ? (sub.detail.resultLinkIds as string[]) : [];
          ev = { link: sub?.link ?? null, detail: { resultFileIds: approvedFileIds, resultLinkIds: approvedLinkIds } };
          // Disetujui Manager = persyaratan persetujuan hasil pekerjaan di DTIC Nexus terpenuhi → Hasil Final.
          if (approvedFileIds.length > 0) driveMove = { fileIds: approvedFileIds, category: "hasil_final" };
        }
        break;
      case "request_revision":
        to = "internal_revision"; qc = "revision"; kind = "qc_revision_requested"; notify = true;
        break;
      case "request_access":
        // Hasil belum dapat diperiksa: pengajuan dikembalikan ke PIC tanpa keputusan atas kualitas hasil.
        to = "in_progress"; qc = "none"; kind = "qc_access_requested"; notify = true;
        break;
      case "record_delivery":
        // Status QC TIDAK diubah: pengiriman langsung bukan persetujuan Manager. Tetap diberitahukan
        // (notify_status_changed) sebagai event terpisah dari "Menunggu QC Manager" — pesan memuat label
        // status "Menunggu Masukan Pemohon" apa adanya, tidak pernah mengklaim persetujuan QC.
        to = "awaiting_requester"; kind = "delivery_recorded"; notify = true;
        ev = { stage: input.stage ?? null, link: input.link, detail: { afterQc: o.qc_status === "approved", qcStatusAtSend: o.qc_status, sentAt: input.sentAt ?? null, channel: input.channel ?? null, resultFileIds: fileIds, resultLinkIds: linkIds } };
        break;
      case "record_feedback":
        kind = "feedback_recorded"; ev = { needsRevision: input.needsRevision };
        if (input.needsRevision) { to = "in_progress"; qc = "none"; }
        break;
      case "complete":
        // Tidak membuat catatan pengiriman/persetujuan: hanya penyelesaian beserta keterangannya.
        to = "completed"; kind = "completed"; notify = true;
        ev = { link: input.link, detail: { deliveryRecorded: o.status === "awaiting_requester", qcStatusAtCompletion: o.qc_status, fromStatus: o.status, resultFileIds: fileIds, resultLinkIds: linkIds } };
        // Penyelesaian tanpa persetujuan QC Manager (mis. diserahkan langsung ke pemohon) — file yang
        // dirujuk saat menyelesaikan tetap dipindahkan ke Hasil Final; tidak menimpa pemindahan approve_qc
        // di atas bila kedua aksi sama-sama merujuk file yang sama (idempoten di moveResultFilesToCategory).
        if (fileIds.length > 0 && !driveMove) driveMove = { fileIds, category: "hasil_final" };
        break;
    }

    if (qc !== o.qc_status) await tx`update orders set qc_status = ${qc} where id = ${orderId}`;
    if (to !== o.status) {
      await tx`select set_config('dtic.status_note', ${note ?? ""}, true)`;
      await tx`select set_config('dtic.status_note_public', 'false', true)`;
      await tx`select set_config('dtic.actor_id', ${actor.userId}, true)`;
      await tx`update orders set status = ${to} where id = ${orderId}`;
    }
    await tx`
      insert into order_workflow_events (order_id, kind, actor_user_id, actor_name, stage, link, summary, needs_revision, detail, request_key)
      values (${orderId}, ${kind}, ${actor.userId}, ${actor.name}, ${ev.stage ?? null}, ${ev.link ?? null}, ${note},
              ${ev.needsRevision ?? null}, ${tx.json((ev.detail ?? {}) as postgres.JSONValue)}, ${input.requestKey ?? null})`;

    let outboxId: string | null = null;
    let notification: "enqueue_failed" | undefined;
    if (notify && to !== o.status) {
      const [h] = await tx<{ id: string }[]>`select id from order_status_history where order_id = ${orderId} order by changed_at desc, id desc limit 1`;
      try {
        outboxId = await tx.savepoint((sp) => enqueueOrderNotification(sp, { orderId, kind: "status_changed", eventType: eventTypeForStatus(to), eventRef: h.id }));
      } catch (error) {
        // Kegagalan antrean notifikasi tidak membatalkan aksi yang sudah sah.
        notification = "enqueue_failed";
        console.error("[qc] gagal mengantrekan notifikasi:", error instanceof Error ? error.message : "error");
      }
    }
    return { changed: true, duplicate: false, status: to, outboxId, notification, driveMove };
  });
  if (driveMove) await moveResultFilesToCategory(orderId, driveMove.fileIds, driveMove.category, driveMove.revisionNumber);
  return result;
}

/** Pengguna ini pernah membuka WhatsApp pemohon untuk pekerjaan ini (menentukan perlu tidaknya perkenalan). */
export async function hasContactedRequester(orderId: string, userId: string): Promise<boolean> {
  const rows = await sql()`select 1 from order_workflow_events where order_id = ${orderId} and kind = 'whatsapp_opened' and actor_user_id = ${userId} limit 1`;
  return rows.length > 0;
}

/**
 * Catat bahwa WhatsApp dibuka dengan pesan yang disiapkan. Bukan bukti pesan terkirim; isi pesan TIDAK disimpan
 * (hanya jenis template & apakah diedit). requestKey mencegah catatan ganda saat klik ganda/retry.
 */
export async function logWhatsappOpened(orderId: string, input: { template: string; templateLabel: string; edited: boolean; requestKey: string }, actor: { userId: string; name: string }) {
  await sql()`
    insert into order_workflow_events (order_id, kind, actor_user_id, actor_name, detail, request_key)
    values (${orderId}, 'whatsapp_opened', ${actor.userId}, ${actor.name},
            ${sql().json({ template: input.template, templateLabel: input.templateLabel, edited: input.edited })}, ${input.requestKey})
    on conflict (order_id, request_key) where request_key is not null do nothing`;
}
