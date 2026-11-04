import { findSession, tokenFromRequest } from "@/lib/server/auth";
import { errorResponse, json } from "@/lib/server/http";
import { listFeedbackTickets } from "@/lib/server/repositories/feedback";

/**
 * Tiket Bantuan & Masukan milik akun yang sedang login — dipakai Pusat Bantuan mengambang (panel
 * "Tiket Saya") dan halaman /dtic/bantuan. Dibatasi reporterUserId = sesi sendiri — BUKAN endpoint
 * admin (/api/internal/feedback belum ada sebagai daftar umum; lihat listFeedbackTickets dipakai
 * halaman Super Admin dengan filter berbeda). Siapa pun yang login boleh melihat tiketnya sendiri,
 * tidak perlu kapabilitas feedback.manage.
 */
export async function GET(request: Request) {
  try {
    const session = await findSession(tokenFromRequest(request));
    if (!session) return json({ error: "Sesi login tidak ditemukan. Silakan masuk kembali." }, 401);

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    const pageSize = Math.min(20, Math.max(1, Number(url.searchParams.get("pageSize") ?? 10) || 10));

    const { rows, total } = await listFeedbackTickets({ reporterUserId: session.userId, page, pageSize });
    return json({
      total,
      tickets: rows.map((t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
        kind: t.kind,
        title: t.title,
        status: t.status,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    });
  } catch (error) {
    return errorResponse(error, "GET /api/internal/feedback/mine");
  }
}
