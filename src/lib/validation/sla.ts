import { z } from "zod";

/** Hanya tahapan yang BUKAN status akhir boleh punya SLA (completed/cancelled/closed_sla tidak relevan). */
export const slaRuleSchema = z.object({
  designOrderTypeId: z.uuid().nullable(),
  status: z.enum(["submitted", "assigned", "in_progress", "pending_confirmation", "internal_revision", "awaiting_requester", "on_hold"]),
  durationMinutes: z.coerce.number().int().min(1).max(60 * 24 * 90), // maks 90 hari
  isActive: z.coerce.boolean().default(true),
});
