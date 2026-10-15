import "server-only";
import { sql } from "@/lib/server/db";

/** Catat aksi internal (tanpa rahasia). Dipakai untuk kirim ulang Telegram dan penghapusan order. */
export async function recordAudit(actorId: string, action: string, detail: Record<string, unknown>) {
  await sql()`insert into auth_audit_log (actor_user_id, action, detail) values (${actorId}, ${action}, ${sql().json(detail as never)})`;
}

export type AuditRow = {
  id: string;
  action: string;
  actorName: string | null;
  targetEmail: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

/** Log audit terbaru. Tidak pernah memuat hash password atau token sesi (kolom tidak diambil). */
export async function listAuditLog(limit: number): Promise<AuditRow[]> {
  const rows = await sql()<{ id: string; action: string; actor_name: string | null; target_email: string | null; detail: Record<string, unknown>; created_at: Date }[]>`
    select l.id::text as id, l.action, a.full_name as actor_name, t.email as target_email, l.detail, l.created_at
    from auth_audit_log l
    left join app_users a on a.id = l.actor_user_id
    left join app_users t on t.id = l.target_user_id
    order by l.created_at desc, l.id desc
    limit ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorName: r.actor_name,
    targetEmail: r.target_email,
    detail: sanitizeDetail(r.detail),
    createdAt: r.created_at.toISOString(),
  }));
}

/** Buang kunci sensitif bila suatu saat ikut tercatat di detail. */
function sanitizeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const blocked = /password|token|hash|secret/i;
  return Object.fromEntries(Object.entries(detail ?? {}).filter(([k]) => !blocked.test(k)));
}
