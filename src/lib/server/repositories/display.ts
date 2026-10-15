import "server-only";
import { sql } from "@/lib/server/db";
import type { OrderScope } from "@/lib/server/repositories/orders";
import type { OrderStatus } from "@/lib/status";

/** Field untuk layar display. Tidak memuat WhatsApp, brief, catatan internal, atau lampiran. */
export type DisplayItem = {
  id: string;
  orderNumber: string;
  title: string;
  designType: string;
  brandName: string;
  requesterName: string;
  createdAt: string;
  picNames: string[];
  status: OrderStatus;
  priorityName: string | null;
  priorityTone: string | null;
  deadlineAt: string;
  overdue: boolean;
  updatedAt: string;
};

export type DisplaySnapshot = {
  now: string;
  queue: { total: number; items: DisplayItem[] };
  inProgress: { total: number; items: DisplayItem[] };
  done: { total: number; items: DisplayItem[] };
  onHold: number;
};

/** Order selesai terbaru yang ditampilkan di kolom selesai (di luar yang masih menunggu konfirmasi). */
const RECENT_DONE = 12;

type Row = {
  id: string; order_number: string; title: string; design_type: string; brand_name: string; requester_name: string; created_at: Date; status: OrderStatus;
  priority_name: string | null; priority_tone: string | null; priority_rank: number | null; deadline_at: Date; updated_at: Date;
  completed_at: Date | null; pic_names: string[] | null;
};

const toItem = (r: Row, now: Date): DisplayItem => ({
  id: r.id,
  orderNumber: r.order_number,
  title: r.title,
  designType: r.design_type,
  brandName: r.brand_name,
  requesterName: r.requester_name,
  createdAt: r.created_at.toISOString(),
  picNames: r.pic_names ?? [],
  status: r.status,
  priorityName: r.priority_name,
  priorityTone: r.priority_tone,
  deadlineAt: r.deadline_at.toISOString(),
  overdue: r.deadline_at.getTime() < now.getTime() && r.status !== "completed" && r.status !== "cancelled",
  updatedAt: r.updated_at.toISOString(),
});

const SELECT = (db: ReturnType<typeof sql>) => db`
  select o.id, o.order_number, o.title, o.design_type, b.name as brand_name, o.requester_name, o.created_at, o.status,
         p.name as priority_name, p.tone as priority_tone, p.sort_order as priority_rank,
         o.deadline_at, o.updated_at, o.completed_at,
         (select array_agg(m.full_name order by a.assigned_at, m.full_name)
            from order_assignments a join dtic_members m on m.id = a.member_id where a.order_id = o.id) as pic_names
  from orders o
  join brands b on b.id = o.brand_id
  left join priority_levels p on p.code = o.priority`;

/**
 * Snapshot layar display. Antrean = submitted + assigned, diurutkan prioritas (tinggi dulu), tenggat terdekat,
 * lalu waktu pengajuan. "Siap dikonfirmasi" = pending_confirmation; "Selesai" = completed terbaru.
 * on_hold dihitung terpisah (bukan pekerjaan aktif). cancelled tidak pernah ditampilkan.
 */
export async function displaySnapshot(scope: OrderScope, now: Date): Promise<DisplaySnapshot> {
  const db = sql();
  const active = await db<Row[]>`
    ${SELECT(db)}
    where o.status in ('submitted', 'assigned', 'in_progress', 'pending_confirmation', 'on_hold')
    ${scope ? (scope.memberId ? db`and exists (select 1 from order_assignments sa where sa.order_id = o.id and sa.member_id = ${scope.memberId})` : db`and false`) : db``}
    order by o.deadline_at asc
    limit 400`;
  const recentDone = await db<Row[]>`
    ${SELECT(db)}
    where o.status = 'completed'
    ${scope ? (scope.memberId ? db`and exists (select 1 from order_assignments sa where sa.order_id = o.id and sa.member_id = ${scope.memberId})` : db`and false`) : db``}
    order by o.completed_at desc nulls last
    limit ${RECENT_DONE}`;

  const queueRows = active
    .filter((r) => r.status === "submitted" || r.status === "assigned")
    .sort((a, b) => (b.priority_rank ?? 0) - (a.priority_rank ?? 0) || a.deadline_at.getTime() - b.deadline_at.getTime() || a.updated_at.getTime() - b.updated_at.getTime());
  const progressRows = active.filter((r) => r.status === "in_progress");
  const confirmRows = active.filter((r) => r.status === "pending_confirmation");
  const doneRows = [...confirmRows, ...recentDone];

  return {
    now: now.toISOString(),
    // Semua order aktif dikirim (bukan dipotong) agar setiap order baru terdeteksi; pagination dilakukan di browser.
    queue: { total: queueRows.length, items: queueRows.map((r) => toItem(r, now)) },
    inProgress: { total: progressRows.length, items: progressRows.map((r) => toItem(r, now)) },
    done: { total: doneRows.length, items: doneRows.map((r) => toItem(r, now)) },
    onHold: active.filter((r) => r.status === "on_hold").length,
  };
}
