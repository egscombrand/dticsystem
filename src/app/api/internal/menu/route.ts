import { authorize } from "@/lib/server/auth";
import { errorResponse, json } from "@/lib/server/http";
import { listMenuItems } from "@/lib/server/repositories/menu";

/** Konfigurasi menu lengkap untuk Super Admin (termasuk item yang disembunyikan). */
export async function GET(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    return json({ items: await listMenuItems() });
  } catch (error) {
    return errorResponse(error, "GET menu");
  }
}
