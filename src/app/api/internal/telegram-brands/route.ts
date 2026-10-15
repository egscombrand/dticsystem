import { authorize } from "@/lib/server/auth";
import { errorResponse, json } from "@/lib/server/http";
import { listBrandRows } from "@/lib/server/repositories/telegram-brands";

/** Daftar brand dan konfigurasi Telegram-nya. Hanya Super Admin; chat ID hanya tampil tersamarkan. */
export async function GET(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    return json({ brands: await listBrandRows() });
  } catch (error) {
    return errorResponse(error, "GET telegram-brands");
  }
}
