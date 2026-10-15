import { authorize } from "@/lib/server/auth";
import { errorResponse, json } from "@/lib/server/http";
import { listAuditLog } from "@/lib/server/repositories/audit";

export async function GET(request: Request) {
  const auth = await authorize(request, "audit.view");
  if (!auth.ok) return auth.response;
  try {
    const raw = Number(new URL(request.url).searchParams.get("limit") ?? 100);
    const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 200) : 100;
    return json({ rows: await listAuditLog(limit) });
  } catch (error) {
    return errorResponse(error, "GET audit");
  }
}
