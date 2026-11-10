import { errorResponse, json } from "@/lib/server/http";
import { publicBadges } from "@/lib/server/services/collab";

/** Penanda perhatian untuk daftar "Request saya" (maks. 20 nomor, satu query). */
export async function GET(request: Request) {
  try {
    return json(await publicBadges(request, new URL(request.url).searchParams.get("orders")));
  } catch (error) {
    return errorResponse(error, "GET public badges");
  }
}
