import "server-only";
import { sql } from "@/lib/server/db";
import { FINISHED_STATUSES, ORDER_STATUSES, type OrderStatus } from "@/lib/status";
import { fromOrders, listColumns, mapListItem, type OrderRow, scopeWhere } from "@/lib/server/repositories/orders";
import { dayKeysBetween } from "@/lib/dates";

const FINISHED = FINISHED_STATUSES as unknown as string[];

export type DashboardFilters = {
  /** Cakupan akun (Staff hanya melihat order yang ditugaskan kepadanya). */
  scope?: import("@/lib/server/repositories/orders").OrderScope;
  /** Rentang tanggal masuk (created_at), sudah dikonversi ke UTC. `to` eksklusif. */
  from?: Date;
  to?: Date;
  brandId?: string;
};

export type DashboardStats = {
  total: number;
  overdue: number;
  /** Jumlah order per status (status baru). */
  byStatus: Record<OrderStatus, number>;
};

export type BrandSummary = { brandId: string; brandName: string; isActive: boolean; total: number; active: number; overdue: number };

export async function getDashboardData(filters: DashboardFilters, now = new Date()) {
  const db = sql();
  const where = db`
    where true
    ${scopeWhere(db, filters.scope)}
    ${filters.from ? db`and o.created_at >= ${filters.from}` : db``}
    ${filters.to ? db`and o.created_at < ${filters.to}` : db``}
    ${filters.brandId ? db`and o.brand_id = ${filters.brandId}` : db``}`;

  const [statusRows, [overdueRow], brandRows, recentRows, upcomingRows] = await Promise.all([
    db<{ status: OrderStatus; count: number }[]>`
      select o.status, count(*)::int as count from orders o ${where} group by o.status`,
    db<{ count: number }[]>`
      select count(*)::int as count from orders o ${where}
      and o.deadline_at < ${now} and o.status not in ${db(FINISHED)}`,
    db<{ brand_id: string; brand_name: string; is_active: boolean; total: number; active: number; overdue: number }[]>`
      select b.id as brand_id, b.name as brand_name, b.is_active,
             count(o.id)::int as total,
             count(o.id) filter (where o.status not in ${db(FINISHED)})::int as active,
             count(o.id) filter (where o.status not in ${db(FINISHED)} and o.deadline_at < ${now})::int as overdue
      from brands b
      left join orders o on o.brand_id = b.id ${filters.scope ? db`and o.id in (select sa.order_id from order_assignments sa where ${filters.scope.memberId ? db`sa.member_id = ${filters.scope.memberId}` : db`false`})` : db``}
        ${filters.from ? db`and o.created_at >= ${filters.from}` : db``}
        ${filters.to ? db`and o.created_at < ${filters.to}` : db``}
      ${filters.brandId ? db`where b.id = ${filters.brandId}` : db``}
      group by b.id
      order by b.sort_order, b.name`,
    db<OrderRow[]>`
      select ${listColumns(db)} from ${fromOrders(db)} ${where}
      order by o.created_at desc limit 6`,
    db<OrderRow[]>`
      select ${listColumns(db)} from ${fromOrders(db)} ${where}
      and o.status not in ${db(FINISHED)}
      order by o.deadline_at asc limit 6`,
  ]);

  const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const r of statusRows) if (r.status in byStatus) byStatus[r.status] = r.count;

  const stats: DashboardStats = {
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    overdue: overdueRow.count,
    byStatus,
  };

  const brands: BrandSummary[] = brandRows.map((r) => ({
    brandId: r.brand_id,
    brandName: r.brand_name,
    isActive: r.is_active,
    total: r.total,
    active: r.active,
    overdue: r.overdue,
  }));

  return { stats, brands, recent: recentRows.map(mapListItem), upcoming: upcomingRows.map(mapListItem) };
}

export type DayCount = { day: string; intake: number; completed: number };
export type TeamCount = { teamId: string | null; name: string; count: number };

/**
 * Data grafik dashboard: tren masuk & selesai per hari (zona WIB), dan jumlah per tim.
 * Pekerjaan dihitung per record (bukan per PIC), sehingga pekerjaan multi-PIC tidak tergandakan.
 * Tim efektif = tim pekerjaan, atau tim jenis pekerjaan bila pekerjaan lama belum memiliki tim.
 */
export async function getDashboardCharts(
  filters: { scope?: import("@/lib/server/repositories/orders").OrderScope; brandId?: string; trendFrom: Date; trendTo: Date; rangeFrom?: Date; rangeTo?: Date },
): Promise<{ trend: DayCount[]; byTeam: TeamCount[] }> {
  const db = sql();
  const EFF = db`coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id))`;
  const common = db`${scopeWhere(db, filters.scope)} ${filters.brandId ? db`and o.brand_id = ${filters.brandId}` : db``}`;
  const [intake, completed, teams] = await Promise.all([
    db<{ day: string; count: number }[]>`
      select to_char(o.created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD') as day, count(*)::int as count
      from orders o where true ${common}
      and o.created_at >= ${filters.trendFrom} and o.created_at < ${filters.trendTo}
      group by 1`,
    db<{ day: string; count: number }[]>`
      select to_char(o.completed_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD') as day, count(*)::int as count
      from orders o where o.status = 'completed' and o.completed_at is not null ${common}
      and o.completed_at >= ${filters.trendFrom} and o.completed_at < ${filters.trendTo}
      group by 1`,
    db<{ team_id: string | null; name: string | null; count: number }[]>`
      select ${EFF} as team_id, (select t.name from dtic_teams t where t.id = ${EFF}) as name, count(*)::int as count
      from orders o where true ${common}
      ${filters.rangeFrom ? db`and o.created_at >= ${filters.rangeFrom}` : db``}
      ${filters.rangeTo ? db`and o.created_at < ${filters.rangeTo}` : db``}
      group by 1, 2 order by count desc, name nulls last`,
  ]);
  const byDayIntake = new Map(intake.map((r) => [r.day, r.count]));
  const byDayDone = new Map(completed.map((r) => [r.day, r.count]));
  const trend: DayCount[] = [];
  for (const day of dayKeysBetween(filters.trendFrom, filters.trendTo)) {
    trend.push({ day, intake: byDayIntake.get(day) ?? 0, completed: byDayDone.get(day) ?? 0 });
  }
  return {
    trend,
    byTeam: teams.map((t) => ({ teamId: t.team_id, name: t.name ?? "Tanpa tim", count: t.count })),
  };
}
