import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { deleteSlaRule, updateSlaRule } from "@/lib/server/repositories/sla";
import { toFieldErrors } from "@/lib/validation/common";
import { slaRuleSchema } from "@/lib/validation/sla";

export async function PATCH(request: Request, ctx: RouteContext<"/api/internal/settings/sla-rules/[id]">) {
  const auth = await authorize(request, "master.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Aturan SLA");
    const parsed = slaRuleSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali isian.", 422, toFieldErrors(parsed.error));
    await updateSlaRule(id, parsed.data);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "PATCH sla-rules");
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/internal/settings/sla-rules/[id]">) {
  const auth = await authorize(request, "master.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Aturan SLA");
    await deleteSlaRule(id);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "DELETE sla-rules");
  }
}
