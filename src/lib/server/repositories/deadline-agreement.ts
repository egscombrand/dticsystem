import "server-only";
import type postgres from "postgres";
import type { Role } from "@/lib/auth/permissions";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { FINISHED_STATUSES, type OrderStatus } from "@/lib/status";
import {
  MAX_PIC_PROPOSALS,
  pendingChange,
  picCanDecide,
  type DeadlineAgreementStatus,
  type DeadlineEvent,
  type DeadlineEventKind,
} from "@/lib/deadline-agreement";

export type DeadlineAgreementView = {
  status: DeadlineAgreementStatus;
  requestedDeadline: string;
  picEstimatedDeadline: string | null;
  agreedDeadline: string | null;
  agreedAt: string | null;
  events: DeadlineEvent[];
};

export type AgreementActor = { userId: string | null; name: string; role: Role | "requester"; memberId: string | null };

type OrderRow = {
  status: OrderStatus;
  deadline_agreement_status: DeadlineAgreementStatus;
  requested_deadline: Date;
  pic_estimated_deadline: Date | null;
  agreed_deadline: Date | null;
  agreed_at: Date | null;
  deadline_at: Date;
};

const FINISHED = FINISHED_STATUSES as readonly string[];

async function loadEvents(db: postgres.Sql | postgres.TransactionSql, orderId: string): Promise<DeadlineEvent[]> {
  const rows = await db<
    { kind: DeadlineEventKind; round: number | null; proposed_deadline: Date | null; previous_deadline: Date | null; reason: string | null; actor_name: string | null; created_at: Date }[]
  >`select kind, round, proposed_deadline, previous_deadline, reason, actor_name, created_at
    from order_deadline_events where order_id = ${orderId} order by created_at, id`;
  return rows.map((r) => ({
    kind: r.kind,
    round: r.round,
    proposedDeadline: r.proposed_deadline?.toISOString() ?? null,
    previousDeadline: r.previous_deadline?.toISOString() ?? null,
    reason: r.reason,
    actorName: r.actor_name,
    at: r.created_at.toISOString(),
  }));
}

export async function getDeadlineAgreement(orderId: string): Promise<DeadlineAgreementView | null> {
  const db = sql();
  const [o] = await db<OrderRow[]>`
    select status, deadline_agreement_status, requested_deadline, pic_estimated_deadline, agreed_deadline, agreed_at, deadline_at
    from orders where id = ${orderId}`;
  if (!o) return null;
  return toView(o, await loadEvents(db, orderId));
}

function toView(o: OrderRow, events: DeadlineEvent[]): DeadlineAgreementView {
  return {
    status: o.deadline_agreement_status,
    requestedDeadline: (o.requested_deadline ?? o.deadline_at).toISOString(),
    picEstimatedDeadline: o.pic_estimated_deadline?.toISOString() ?? null,
    agreedDeadline: o.agreed_deadline?.toISOString() ?? null,
    agreedAt: o.agreed_at?.toISOString() ?? null,
    events,
  };
}

async function lockOrder(tx: postgres.TransactionSql, orderId: string): Promise<OrderRow> {
  const [o] = await tx<OrderRow[]>`
    select status, deadline_agreement_status, requested_deadline, pic_estimated_deadline, agreed_deadline, agreed_at, deadline_at
    from orders where id = ${orderId} for update`;
  if (!o) throw new NotFoundError("Order tidak ditemukan.");
  if (FINISHED.includes(o.status)) throw new AppError("Pekerjaan sudah selesai atau dibatalkan; waktu pengerjaan tidak dapat diubah.", 409);
  return o;
}

async function assertPic(tx: postgres.TransactionSql, orderId: string, actor: AgreementActor) {
  if (actor.role === "super_admin") return;
  if (actor.role === "staff" && actor.memberId) {
    const [a] = await tx`select 1 from order_assignments where order_id = ${orderId} and member_id = ${actor.memberId}`;
    if (a) return;
  }
  throw new AppError("Hanya PIC pekerjaan ini yang dapat memberikan estimasi waktu.", 403);
}

async function addEvent(
  tx: postgres.TransactionSql,
  orderId: string,
  e: { kind: DeadlineEventKind; round?: number | null; proposed?: Date | null; previous?: Date | null; reason?: string | null; actor: AgreementActor },
) {
  await tx`insert into order_deadline_events (order_id, kind, round, proposed_deadline, previous_deadline, reason, actor_user_id, actor_name)
           values (${orderId}, ${e.kind}, ${e.round ?? null}, ${e.proposed ?? null}, ${e.previous ?? null}, ${e.reason ?? null},
                   ${e.actor.userId}, ${e.actor.name})`;
}

function requireReason(reason: string | null | undefined, label: string): string {
  const r = (reason ?? "").trim();
  if (!r) throw new AppError(`${label} wajib diisi.`, 422, { reason: `${label} wajib diisi.` });
  return r.slice(0, 1000);
}

function assertFuture(d: Date) {
  if (Number.isNaN(d.getTime())) throw new AppError("Tanggal tidak valid.", 422, { deadlineAt: "Tanggal tidak valid." });
  if (d.getTime() <= Date.now()) throw new AppError("Deadline harus di masa depan.", 422, { deadlineAt: "Deadline harus di masa depan." });
}

/** PIC menyetujui waktu yang diminta Pemohon → langsung sepakat. */
export async function picAcceptRequested(orderId: string, actor: AgreementActor): Promise<DeadlineAgreementView> {
  return sql().begin(async (tx) => {
    const o = await lockOrder(tx, orderId);
    await assertPic(tx, orderId, actor);
    if (!picCanDecide(o.deadline_agreement_status)) throw new AppError("Tahap kesepakatan waktu saat ini tidak menunggu keputusan PIC.", 409);
    // Setelah Pemohon meminta penyesuaian, "terima" berarti menerima deadline yang DIMINTA pemohon semula.
    const agreed = o.requested_deadline;
    await tx`update orders set deadline_agreement_status = 'agreed', agreed_deadline = ${agreed}, pic_estimated_deadline = ${agreed},
               agreed_at = now() where id = ${orderId}`;
    await addEvent(tx, orderId, { kind: "pic_accepted_requested", proposed: agreed, actor });
    return toView(await lockOrderAny(tx, orderId), await loadEvents(tx, orderId));
  });
}

async function lockOrderAny(tx: postgres.TransactionSql, orderId: string): Promise<OrderRow> {
  const [o] = await tx<OrderRow[]>`
    select status, deadline_agreement_status, requested_deadline, pic_estimated_deadline, agreed_deadline, agreed_at, deadline_at
    from orders where id = ${orderId}`;
  return o!;
}

/**
 * PIC mengusulkan deadline (alasan wajib bila berbeda dari permintaan awal). Sebelum sepakat → menunggu
 * persetujuan Pemohon. Sesudah sepakat → usulan PERUBAHAN; deadline sepakat lama tetap berlaku sampai disetujui.
 */
export async function picPropose(orderId: string, actor: AgreementActor, deadlineAt: Date, reason: string | null): Promise<DeadlineAgreementView> {
  assertFuture(deadlineAt);
  return sql().begin(async (tx) => {
    const o = await lockOrder(tx, orderId);
    await assertPic(tx, orderId, actor);
    const events = await loadEvents(tx, orderId);
    if (o.deadline_agreement_status === "agreed") {
      if (pendingChange(events)) throw new AppError("Masih ada usulan perubahan deadline yang menunggu jawaban Pemohon.", 409);
      if (o.agreed_deadline && o.agreed_deadline.getTime() === deadlineAt.getTime()) throw new AppError("Deadline yang diusulkan sama dengan deadline sepakat saat ini.", 422, { deadlineAt: "Sama dengan deadline saat ini." });
      const r = requireReason(reason, "Alasan perubahan deadline");
      await tx`update orders set pic_estimated_deadline = ${deadlineAt} where id = ${orderId}`;
      await addEvent(tx, orderId, { kind: "change_proposed", proposed: deadlineAt, previous: o.agreed_deadline, reason: r, actor });
    } else {
      if (!picCanDecide(o.deadline_agreement_status)) throw new AppError("Tahap kesepakatan waktu saat ini tidak menunggu usulan PIC.", 409);
      const differs = deadlineAt.getTime() !== o.requested_deadline.getTime();
      const r = differs ? requireReason(reason, "Alasan penyesuaian waktu") : (reason ?? "").trim() || null;
      const round = events.filter((e) => e.kind === "pic_proposed").length + 1;
      await tx`update orders set deadline_agreement_status = 'awaiting_requester', pic_estimated_deadline = ${deadlineAt} where id = ${orderId}`;
      await addEvent(tx, orderId, { kind: "pic_proposed", round, proposed: deadlineAt, previous: o.requested_deadline, reason: r, actor });
    }
    return toView(await lockOrderAny(tx, orderId), await loadEvents(tx, orderId));
  });
}

/**
 * Jawaban Pemohon (tanpa akun, lewat Riwayat Request publik). Menjawab usulan awal ATAU usulan perubahan
 * setelah sepakat — mana yang sedang menunggu ditentukan dari data, bukan dari klien.
 */
export async function requesterRespond(
  orderId: string,
  decision: "approve" | "adjust",
  reason: string | null,
  requesterName: string,
): Promise<DeadlineAgreementView> {
  const actor: AgreementActor = { userId: null, name: `${requesterName} (Pemohon)`, role: "requester", memberId: null };
  return sql().begin(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const events = await loadEvents(tx, orderId);
    const change = o.deadline_agreement_status === "agreed" ? pendingChange(events) : null;

    if (change) {
      if (decision === "approve") {
        await tx`update orders set agreed_deadline = ${change.proposedDeadline}, agreed_at = now() where id = ${orderId}`;
        await addEvent(tx, orderId, { kind: "change_approved", proposed: change.proposedDeadline ? new Date(change.proposedDeadline) : null, previous: o.agreed_deadline, reason: (reason ?? "").trim() || null, actor });
      } else {
        const r = requireReason(reason, "Alasan");
        await tx`update orders set pic_estimated_deadline = ${o.agreed_deadline} where id = ${orderId}`;
        await addEvent(tx, orderId, { kind: "change_rejected", proposed: change.proposedDeadline ? new Date(change.proposedDeadline) : null, previous: o.agreed_deadline, reason: r, actor });
      }
      return toView(await lockOrderAny(tx, orderId), await loadEvents(tx, orderId));
    }

    if (o.deadline_agreement_status !== "awaiting_requester") throw new AppError("Saat ini tidak ada usulan waktu yang menunggu persetujuan Anda.", 409);
    if (!o.pic_estimated_deadline) throw new AppError("Usulan waktu tidak ditemukan.", 409);
    if (decision === "approve") {
      await tx`update orders set deadline_agreement_status = 'agreed', agreed_deadline = ${o.pic_estimated_deadline}, agreed_at = now() where id = ${orderId}`;
      await addEvent(tx, orderId, { kind: "requester_approved", proposed: o.pic_estimated_deadline, previous: o.requested_deadline, reason: (reason ?? "").trim() || null, actor });
    } else {
      const r = requireReason(reason, "Alasan penyesuaian");
      const proposals = events.filter((e) => e.kind === "pic_proposed").length;
      await addEvent(tx, orderId, { kind: "requester_adjustment_requested", proposed: o.pic_estimated_deadline, reason: r, actor });
      if (proposals >= MAX_PIC_PROPOSALS) {
        await tx`update orders set deadline_agreement_status = 'escalated' where id = ${orderId}`;
        await addEvent(tx, orderId, {
          kind: "escalated",
          reason: `Belum ada kesepakatan setelah ${proposals} usulan PIC; menunggu keputusan Manager.`,
          actor: { userId: null, name: "Sistem", role: "requester", memberId: null },
        });
      } else {
        await tx`update orders set deadline_agreement_status = 'adjustment_requested' where id = ${orderId}`;
      }
    }
    return toView(await lockOrderAny(tx, orderId), await loadEvents(tx, orderId));
  });
}

/** Manager/Super Admin menetapkan deadline final untuk pengajuan yang belum sepakat (alasan wajib). */
export async function managerResolve(orderId: string, actor: AgreementActor, deadlineAt: Date, reason: string | null): Promise<DeadlineAgreementView> {
  if (actor.role !== "manager" && actor.role !== "super_admin") throw new AppError("Hanya Manager atau Super Admin yang dapat menetapkan deadline final.", 403);
  assertFuture(deadlineAt);
  const r = requireReason(reason, "Alasan keputusan");
  return sql().begin(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (o.deadline_agreement_status === "agreed") throw new AppError("Waktu pengerjaan sudah disepakati; gunakan usulan perubahan deadline.", 409);
    await tx`update orders set deadline_agreement_status = 'agreed', agreed_deadline = ${deadlineAt}, pic_estimated_deadline = coalesce(pic_estimated_deadline, ${deadlineAt}),
               agreed_at = now() where id = ${orderId}`;
    await addEvent(tx, orderId, { kind: "manager_resolved", proposed: deadlineAt, previous: o.pic_estimated_deadline ?? o.requested_deadline, reason: r, actor });
    return toView(await lockOrderAny(tx, orderId), await loadEvents(tx, orderId));
  });
}

/** Dipanggil dari "Ubah tenggat" administratif (dalam transaksi pemanggil) agar riwayat kesepakatan lengkap. */
export async function recordAdminDeadlineChange(
  tx: postgres.TransactionSql,
  orderId: string,
  previous: Date,
  next: Date,
  reason: string,
  actor: { userId: string; name: string },
) {
  await tx`insert into order_deadline_events (order_id, kind, proposed_deadline, previous_deadline, reason, actor_user_id, actor_name)
           values (${orderId}, 'admin_changed', ${next}, ${previous}, ${reason.slice(0, 1000)}, ${actor.userId}, ${actor.name})`;
}
