import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { replyToFeedbackTicket } from "@/lib/server/services/feedback";

/** Pelapor menjawab pertanyaan Super Admin ("Menunggu Informasi") — murni berdasar nomor tiket, tanpa sesi. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJson(request)) as { ticketNumber?: unknown; message?: unknown };
    return json(await replyToFeedbackTicket(request, { ticketNumber: body.ticketNumber, message: body.message }));
  } catch (error) {
    return errorResponse(error, "POST /api/public/feedback/reply");
  }
}
