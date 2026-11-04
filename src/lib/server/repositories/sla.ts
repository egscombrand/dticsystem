import "server-only";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError, pgConstraint, pgErrorCode } from "@/lib/server/errors";
import type { OrderStatus } from "@/lib/status";

export type SlaRule = {
  id: string;
  designOrderTypeId: string | null;
  designOrderTypeName: string | null; // null = aturan default (berlaku untuk jenis tanpa aturan khusus)
  status: OrderStatus;
  durationMinutes: number;
  isActive: boolean;
};

export type SlaRuleInput = { designOrderTypeId: string | null; status: OrderStatus; durationMinutes: number; isActive: boolean };

/** Dikelola Admin (master.manage) — daftar lengkap, termasuk nonaktif, urut jenis lalu tahapan. */
export async function listSlaRules(): Promise<SlaRule[]> {
  const rows = await sql()<{ id: string; design_order_type_id: string | null; type_name: string | null; status: OrderStatus; duration_minutes: number; is_active: boolean }[]>`
    select r.id, r.design_order_type_id, t.name as type_name, r.status, r.duration_minutes, r.is_active
    from sla_rules r left join design_order_types t on t.id = r.design_order_type_id
    order by t.name nulls first, r.status`;
  return rows.map((r) => ({ id: r.id, designOrderTypeId: r.design_order_type_id, designOrderTypeName: r.type_name, status: r.status, durationMinutes: r.duration_minutes, isActive: r.is_active }));
}

export async function createSlaRule(input: SlaRuleInput): Promise<string> {
  try {
    const [row] = await sql()<{ id: string }[]>`
      insert into sla_rules (design_order_type_id, status, duration_minutes, is_active)
      values (${input.designOrderTypeId}, ${input.status}, ${input.durationMinutes}, ${input.isActive})
      returning id`;
    return row.id;
  } catch (error) {
    if (pgErrorCode(error) === "23505" && pgConstraint(error)?.startsWith("sla_rules_"))
      throw new AppError("Sudah ada aturan SLA untuk kombinasi jenis pengajuan dan tahapan ini.", 409);
    throw error;
  }
}

export async function updateSlaRule(id: string, input: SlaRuleInput): Promise<void> {
  try {
    const rows = await sql()`
      update sla_rules set design_order_type_id = ${input.designOrderTypeId}, status = ${input.status},
             duration_minutes = ${input.durationMinutes}, is_active = ${input.isActive}, updated_at = now()
      where id = ${id} returning id`;
    if (rows.length === 0) throw new NotFoundError("Aturan SLA tidak ditemukan.");
  } catch (error) {
    if (pgErrorCode(error) === "23505" && pgConstraint(error)?.startsWith("sla_rules_"))
      throw new AppError("Sudah ada aturan SLA untuk kombinasi jenis pengajuan dan tahapan ini.", 409);
    throw error;
  }
}

export async function deleteSlaRule(id: string): Promise<void> {
  const rows = await sql()`delete from sla_rules where id = ${id} returning id`;
  if (rows.length === 0) throw new NotFoundError("Aturan SLA tidak ditemukan.");
}
