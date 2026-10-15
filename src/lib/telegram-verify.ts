import type { TelegramLinkTarget } from "@/lib/telegram-link";

/**
 * Keputusan verifikasi grup dari jawaban Bot API (murni). Status "verified" hanya dihasilkan bila
 * identitas chat yang dikembalikan Telegram COCOK dengan kandidat dari link, dan bot terbukti anggota
 * (atau admin untuk kanal). Kandidat dari link tidak pernah dianggap sebagai bukti sendiri.
 */
export type ChatInfo = { id: number | string; type: string; title?: string; username?: string; is_forum?: boolean };

export type VerifyDecision =
  | { status: "verified"; chatId: string; chatTitle: string | null; chatUsername: string | null; threadId: number | null }
  | { status: "bot_no_access"; message: string }
  | { status: "target_mismatch"; message: string }
  | { status: "not_group"; message: string }
  | { status: "failed"; message: string };

export function decideVerification(input: {
  target: TelegramLinkTarget;
  chat: ChatInfo | null;
  /** Status keanggotaan bot di chat (dari getChatMember). Null bila belum/tidak tersedia. */
  botStatus: string | null;
  /** Kegagalan getChat yang sudah disanitasi. "no_access" = bot tidak bisa melihat chat tersebut. */
  lookupFailure?: "no_access" | "failed";
  lookupMessage?: string;
}): VerifyDecision {
  const { target, chat, botStatus, lookupFailure } = input;
  if (lookupFailure === "no_access" || (!chat && !lookupFailure)) {
    return { status: "bot_no_access", message: "Bot belum memiliki akses ke grup ini. Tambahkan bot ke grup (sebagai admin untuk kanal), lalu verifikasi ulang." };
  }
  if (!chat) return { status: "failed", message: input.lookupMessage ?? "Grup tidak dapat diverifikasi saat ini. Coba lagi beberapa saat." };
  if (chat.type !== "group" && chat.type !== "supergroup" && chat.type !== "channel") {
    return { status: "not_group", message: "Link ini bukan grup atau kanal Telegram." };
  }
  const chatIdStr = String(chat.id);
  // Privat: supergroup/kanal = "-100" + ID; grup biasa (type "group") = "-" + ID. Keduanya harus dikonfirmasi Telegram.
  const matches =
    target.kind === "private"
      ? chatIdStr === target.candidateChatId || (chat.type === "group" && chatIdStr === `-${target.internalId}`)
      : (chat.username ?? "").toLowerCase() === target.username.toLowerCase();
  if (!matches) {
    return { status: "target_mismatch", message: "Grup yang ditemukan tidak cocok dengan link. Pastikan link berasal dari grup tempat bot ditambahkan." };
  }
  const isMember = botStatus === "member" || botStatus === "administrator" || botStatus === "creator";
  const isAdmin = botStatus === "administrator" || botStatus === "creator";
  if (!isMember || (chat.type === "channel" && !isAdmin)) {
    return {
      status: "bot_no_access",
      message: chat.type === "channel"
        ? "Jadikan bot sebagai admin kanal ini agar dapat mengirim pesan, lalu verifikasi ulang."
        : "Bot belum menjadi anggota grup ini. Tambahkan bot ke grup, lalu verifikasi ulang.",
    };
  }
  // Grup forum: angka pertama pada link = topik tujuan. "1" adalah General (tanpa message_thread_id).
  const topic = chat.is_forum && target.topicCandidate && target.topicCandidate !== "1" ? Number(target.topicCandidate) : null;
  return { status: "verified", chatId: chatIdStr, chatTitle: chat.title ?? null, chatUsername: chat.username ?? null, threadId: topic };
}
