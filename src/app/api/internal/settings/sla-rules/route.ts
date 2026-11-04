import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { createSlaRule, listSlaRules } from "@/lib/server/repositories/sla";
import { toFieldErrors } from "@/lib/validation/common";
import { slaRuleSchema } from "@/lib/validation/sla";

/** Konfigurasi SLA per tahapan — khusus Admin (master.manage), sama seperti data master lain. */
export async function GET(request: Request) {
  const auth = await authorize(request, "master.manage");
  if (!auth.ok) return auth.response;
  try {
    return json({ rules: await listSlaRules() });
  } catch (error) {
    return errorResponse(error, "GET sla-rules");
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request, "master.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const parsed = slaRuleSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali isian.", 422, toFieldErrors(parsed.error));
    const id = await createSlaRule(parsed.data);
    return json({ ok: true, id }, 201);
  } catch (error) {
    return errorResponse(error, "POST sla-rules");
  }
}
