import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { lookupFeedbackTicket } from "@/lib/server/services/feedback";

/** Pencarian tiket publik: cukup nomor tiket. Tidak ada kode tambahan — sama seperti pencarian order. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJson(request)) as { ticketNumber?: unknown };
    if (typeof body.ticketNumber !== "string" || body.ticketNumber.length > 40) throw new AppError("Nomor tiket wajib diisi.", 422);
    return json(await lookupFeedbackTicket(request, body.ticketNumber));
  } catch (error) {
    return errorResponse(error, "POST /api/public/feedback/lookup");
  }
}
