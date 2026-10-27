import "server-only";
import { sql } from "@/lib/server/db";
import type { OrderStatus } from "@/lib/status";
import type { MemberWorkload } from "@/lib/workload";

/**
 * Workload aktual per anggota, dihitung dari relasi PIC (order_assignments; satu baris per order per anggota,
 * dijamin primary key) sehingga satu order tidak terhitung dua kali untuk anggota yang sama.
 * Statistik dihitung di subquery lateral terpisah dari daftar tim agar join tim tidak menggandakan hitungan.
 * Definisi status: lihat src/lib/workload.ts.
 *
 * teamId diisi → anggota AKTIF tim tersebut (kandidat PIC).
 * teamId kosong → semua anggota aktif yang tergabung dalam tim, ditambah anggota yang masih memegang
 * order berjalan (mis. data lama), agar beban nyata tidak tersembunyi.
 */
export type WorkloadFilters = {
  teamId?: string | null;
  /** Hanya menghitung pekerjaan dengan status ini (kosong = semua status). */
  statuses?: OrderStatus[];
  /** Periode: pekerjaan yang masuk dalam rentang (created_at), `to` eksklusif. */
  from?: Date;
  to?: Date;
};

export async function getMemberWorkloads(filters: WorkloadFilters | string | null = null): Promise<(MemberWorkload & { isActive: boolean })[]> {
  const f: WorkloadFilters = typeof filters === "string" || filters === null ? { teamId: filters } : filters;
  const teamId = f.teamId ?? null;
  const db = sql();
  const orderFilter = db`${f.statuses?.length ? db`and o.status in ${db(f.statuses)}` : db``}
    ${f.from ? db`and o.created_at >= ${f.from}` : db``}
    ${f.to ? db`and o.created_at < ${f.to}` : db``}`;
  const scope = teamId
    ? db`m.is_active and exists (select 1 from dtic_team_members tm where tm.member_id = m.id and tm.team_id = ${teamId})`
    : db`(m.is_active and exists (select 1 from dtic_team_members tm where tm.member_id = m.id))
         or exists (select 1 from order_assignments a join orders o on o.id = a.order_id
                    where a.member_id = m.id and o.status not in ('completed', 'cancelled'))`;
  const rows = await db<
    {
      id: string; full_name: string; position: string; department_name: string; is_active: boolean; teams: string[];
      active: number; in_progress: number; pending: number; on_hold: number; overdue: number; nearest: Date | null;
    }[]
  >`
    select m.id, m.full_name, m.position, d.name as department_name, m.is_active,
           coalesce((select array_agg(t.name order by t.sort_order, t.name)
                     from dtic_team_members tm join dtic_teams t on t.id = tm.team_id
                     where tm.member_id = m.id), '{}') as teams,
           s.active, s.in_progress, s.pending, s.on_hold, s.overdue, s.nearest
    from dtic_members m
    join dtic_departments d on d.id = m.department_id
    cross join lateral (
      select count(*) filter (where o.status in ('submitted', 'assigned', 'in_progress', 'pending_confirmation', 'internal_revision', 'awaiting_requester'))::int as active,
             count(*) filter (where o.status = 'in_progress')::int as in_progress,
             count(*) filter (where o.status = 'pending_confirmation')::int as pending,
             count(*) filter (where o.status = 'on_hold')::int as on_hold,
             count(*) filter (where o.status not in ('completed', 'cancelled') and o.deadline_at < now())::int as overdue,
             min(o.deadline_at) filter (where o.status not in ('completed', 'cancelled')) as nearest
      from order_assignments a join orders o on o.id = a.order_id
      where a.member_id = m.id ${orderFilter}
    ) s
    where (${scope})
    order by s.active desc, s.overdue desc, m.full_name`;
  return rows.map((r) => ({
    memberId: r.id,
    name: r.full_name,
    division: `${r.position} of ${r.department_name}`,
    teams: r.teams,
    isActive: r.is_active,
    active: r.active,
    inProgress: r.in_progress,
    pendingConfirmation: r.pending,
    onHold: r.on_hold,
    overdue: r.overdue,
    nearestDeadline: r.nearest?.toISOString() ?? null,
  }));
}

export type PublicMemberWorkload = { memberId: string; active: number };

/**
 * Versi PUBLIK (untuk form pengajuan, tanpa login) dari getMemberWorkloads — HANYA agregat aman untuk
 * ditampilkan ke pemohon anonim: jumlah pekerjaan aktif. TIDAK menyertakan overdue, onHold, deadline
 * terdekat, atau detail pekerjaan lain (itu untuk panel internal Kelola PIC saja, lihat getMemberWorkloads
 * di atas) — pemohon tidak berhak melihat informasi operasional tim sedetail itu.
 */
export async function getPublicMemberWorkloads(): Promise<PublicMemberWorkload[]> {
  const rows = await getMemberWorkloads(null);
  return rows.map((r) => ({ memberId: r.memberId, active: r.active }));
}

export type MemberActiveOrder = { memberId: string; id: string; orderNumber: string; title: string; status: OrderStatus; deadlineAt: string };

/** Order berjalan (belum selesai/dibatalkan) per anggota, urut deadline terdekat. */
export async function listActiveOrdersForMembers(memberIds: string[]): Promise<MemberActiveOrder[]> {
  if (memberIds.length === 0) return [];
  const db = sql();
  const rows = await db<{ member_id: string; id: string; order_number: string; title: string; status: OrderStatus; deadline_at: Date }[]>`
    select a.member_id, o.id, o.order_number, o.title, o.status, o.deadline_at
    from order_assignments a join orders o on o.id = a.order_id
    where a.member_id in ${db(memberIds)} and o.status not in ('completed', 'cancelled')
    order by o.deadline_at, o.order_number`;
  return rows.map((r) => ({ memberId: r.member_id, id: r.id, orderNumber: r.order_number, title: r.title, status: r.status, deadlineAt: r.deadline_at.toISOString() }));
}

/**
 * Bentuk penugasan pekerjaan aktif: satu PIC, beberapa PIC, atau belum ada PIC. Dihitung per pekerjaan
 * (subquery), sehingga pekerjaan multi-PIC tidak tergandakan. Hanya pekerjaan belum selesai/dibatalkan.
 */
export async function getAssignmentShape(filters: { teamId?: string | null; from?: Date; to?: Date }): Promise<{ single: number; multi: number; unassigned: number; total: number }> {
  const db = sql();
  const EFF = db`coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id))`;
  const [row] = await db<{ single: number; multi: number; unassigned: number; total: number }[]>`
    select count(*) filter (where x.n = 1)::int as single,
           count(*) filter (where x.n > 1)::int as multi,
           count(*) filter (where x.n = 0)::int as unassigned,
           count(*)::int as total
    from (
      select o.id, (select count(*) from order_assignments a where a.order_id = o.id) as n
      from orders o
      where o.status not in ('completed', 'cancelled')
      ${filters.teamId ? db`and ${EFF} = ${filters.teamId}` : db``}
      ${filters.from ? db`and o.created_at >= ${filters.from}` : db``}
      ${filters.to ? db`and o.created_at < ${filters.to}` : db``}
    ) x`;
  return row;
}
