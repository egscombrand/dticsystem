import { authorize } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { disconnectFeedbackChannel, setFeedbackChannelActive } from "@/lib/server/repositories/feedback-telegram";
import { recordAudit } from "@/lib/server/repositories/audit";
import { feedbackTelegramActiveSchema } from "@/lib/validation/feedback";
import { toFieldErrors } from "@/lib/validation/common";

/** Aktif/nonaktif grup Telegram Tim IT (Super Admin). Aktivasi hanya untuk grup terverifikasi. */
export async function PUT(request: Request) {
  const auth = await authorize(request, "feedback.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const parsed = feedbackTelegramActiveSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali pengaturan Telegram.", 422, toFieldErrors(parsed.error));
    await setFeedbackChannelActive(parsed.data.isActive, auth.session.userId);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "PUT feedback-telegram");
  }
}

/** Putuskan grup Telegram Tim IT. Hanya Super Admin. Riwayat tiket tidak terpengaruh. */
export async function DELETE(request: Request) {
  const auth = await authorize(request, "feedback.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { chatTitle } = await disconnectFeedbackChannel();
    await recordAudit(auth.session.userId, "telegram_group_disconnected", { brand: "Bantuan & Masukan (Tim IT)", chat: chatTitle });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "DELETE feedback-telegram");
  }
}
