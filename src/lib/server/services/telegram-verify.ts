import "server-only";
import { readBotConfig } from "@/lib/telegram";
import { describeApiFailure } from "@/lib/telegram-api";
import { callTelegramApi } from "@/lib/server/services/telegram-api";
import { parseTelegramLink } from "@/lib/telegram-link";
import { decideVerification, type ChatInfo } from "@/lib/telegram-verify";
import { maskChatId } from "@/lib/telegram-routing";
import { recordAudit } from "@/lib/server/repositories/audit";
import { brandName, saveVerifiedChannel, type BrandTarget } from "@/lib/server/repositories/telegram-brands";
import { NotFoundError } from "@/lib/server/errors";
import { NO_TOKEN_MESSAGE } from "@/lib/server/services/telegram";

export type VerifyOutcome =
  | { ok: true; status: "verified"; chatTitle: string | null; chatMasked: string; message: string }
  | { ok: false; status: "unsupported_link" | "bot_no_access" | "target_mismatch" | "not_group" | "failed" | "replace_required"; message: string };

/**
 * Verifikasi link grup untuk satu brand (Super Admin). Link hanya menghasilkan KANDIDAT identitas; status
 * terverifikasi dibuat setelah Telegram mengonfirmasi chat yang cocok DAN bot menjadi anggota/admin.
 * Hasil gagal tidak mengubah konfigurasi yang sudah ada.
 */
export async function verifyBrandGroup(brandId: BrandTarget, link: string, replace: boolean, actorId: string): Promise<VerifyOutcome> {
  const bot = readBotConfig();
  if (!bot) return { ok: false, status: "failed", message: NO_TOKEN_MESSAGE };
  const parsed = parseTelegramLink(link);
  if (!parsed.ok) return { ok: false, status: "unsupported_link", message: parsed.message };
  const name = await brandName(brandId);
  if (!name) throw new NotFoundError("Brand tidak ditemukan.");
  const target = parsed.target;

  const me = await callTelegramApi<{ id: number }>(bot, "getMe", {});
  if (!me.ok) return { ok: false, status: "failed", message: describeApiFailure(me) };

  const chatRef = target.kind === "private" ? target.candidateChatId : target.candidateChatRef;
  let chatRes = await callTelegramApi<ChatInfo>(bot, "getChat", { chat_id: chatRef });
  // Grup biasa (bukan supergroup) memakai ID tanpa awalan -100. Dicoba hanya bila Telegram menyatakan
  // kandidat supergroup tidak ada; hasilnya tetap harus bertipe "group" dan bot harus anggota.
  if (!chatRes.ok && target.kind === "private" && chatRes.kind === "telegram" && chatRes.errorCode === 400) {
    const basic = await callTelegramApi<ChatInfo>(bot, "getChat", { chat_id: `-${target.internalId}` });
    if (basic.ok && basic.result.type === "group") chatRes = basic;
  }
  let chat: ChatInfo | null = null;
  let lookupFailure: "no_access" | "failed" | undefined;
  let lookupMessage: string | undefined;
  if (chatRes.ok) {
    chat = chatRes.result;
  } else if (chatRes.kind === "telegram" && (chatRes.errorCode === 400 || chatRes.errorCode === 403)) {
    // Telegram menjawab bahwa chat tidak ada atau bot tidak punya akses: ini bukti, bukan galat jaringan.
    lookupFailure = "no_access";
  } else {
    lookupFailure = "failed";
    lookupMessage = describeApiFailure(chatRes);
  }

  let botStatus: string | null = null;
  if (chat && (chat.type === "group" || chat.type === "supergroup" || chat.type === "channel")) {
    const member = await callTelegramApi<{ status: string }>(bot, "getChatMember", { chat_id: chat.id, user_id: me.result.id });
    if (member.ok) botStatus = member.result.status;
    else if (member.kind !== "telegram") return { ok: false, status: "failed", message: describeApiFailure(member) };
  }

  const decision = decideVerification({ target, chat, botStatus, lookupFailure, lookupMessage });
  if (decision.status !== "verified") {
    return { ok: false, status: decision.status, message: decision.message };
  }

  const saved = await saveVerifiedChannel(
    brandId,
    { chatId: decision.chatId, chatTitle: decision.chatTitle, chatUsername: decision.chatUsername, sourceLink: target.sourceLink, threadId: decision.threadId },
    actorId,
    replace,
  );
  if (saved.kind === "replace_required") {
    return {
      ok: false,
      status: "replace_required",
      message: `Brand ${name} sudah memiliki grup terverifikasi${saved.currentTitle ? ` (${saved.currentTitle})` : ""}. Pilih ganti grup untuk mengubahnya.`,
    };
  }
  const chatMasked = maskChatId(decision.chatId);
  await recordAudit(actorId, "telegram_group_verified", { brand: name, chat: chatMasked, created: saved.created });
  return {
    ok: true,
    status: "verified",
    chatTitle: decision.chatTitle,
    chatMasked,
    message: decision.threadId
      ? `Grup terverifikasi dan terhubung ke ${name}, ke topik #${decision.threadId}. Lakukan tes pesan untuk memastikan topiknya benar, lalu aktifkan integrasi.`
      : `Grup terverifikasi dan terhubung ke ${name}. Lakukan tes pesan, lalu aktifkan integrasi.`,
  };
}
