import { describe, expect, it } from "vitest";
import { parseTelegramLink } from "@/lib/telegram-link";
import { decideVerification } from "@/lib/telegram-verify";

const priv = (() => {
  const r = parseTelegramLink("https://t.me/c/2436417110/9467");
  if (!r.ok) throw new Error("fixture");
  return r.target;
})();
const pub = (() => {
  const r = parseTelegramLink("https://t.me/nama_grup/9467");
  if (!r.ok) throw new Error("fixture");
  return r.target;
})();

describe("keputusan verifikasi grup", () => {
  it("terverifikasi hanya bila chat cocok DAN bot anggota (grup privat)", () => {
    const d = decideVerification({ target: priv, chat: { id: -1002436417110, type: "supergroup", title: "Grup Environesia" }, botStatus: "member" });
    expect(d).toEqual({ status: "verified", chatId: "-1002436417110", chatTitle: "Grup Environesia", chatUsername: null, threadId: null });
  });
  it("kandidat dari link tidak dianggap bukti: chat berbeda → target_mismatch", () => {
    const d = decideVerification({ target: priv, chat: { id: -1009999999999, type: "supergroup" }, botStatus: "member" });
    expect(d.status).toBe("target_mismatch");
  });
  it("chat tidak ditemukan / bot tidak punya akses → bot_no_access", () => {
    expect(decideVerification({ target: priv, chat: null, botStatus: null, lookupFailure: "no_access" }).status).toBe("bot_no_access");
  });
  it("kegagalan lain (mis. rate limit) → failed dengan pesan", () => {
    const d = decideVerification({ target: priv, chat: null, botStatus: null, lookupFailure: "failed", lookupMessage: "Coba lagi." });
    expect(d).toEqual({ status: "failed", message: "Coba lagi." });
  });
  it("bot bukan anggota → bot_no_access walau chat cocok", () => {
    expect(decideVerification({ target: priv, chat: { id: -1002436417110, type: "supergroup" }, botStatus: "left" }).status).toBe("bot_no_access");
    expect(decideVerification({ target: priv, chat: { id: -1002436417110, type: "supergroup" }, botStatus: null }).status).toBe("bot_no_access");
  });
  it("kanal membutuhkan bot sebagai admin", () => {
    expect(decideVerification({ target: priv, chat: { id: -1002436417110, type: "channel" }, botStatus: "member" }).status).toBe("bot_no_access");
    expect(decideVerification({ target: priv, chat: { id: -1002436417110, type: "channel" }, botStatus: "administrator" }).status).toBe("verified");
  });
  it("chat privat (bukan grup/kanal) ditolak", () => {
    expect(decideVerification({ target: pub, chat: { id: 12345, type: "private", username: "nama_grup" }, botStatus: "member" }).status).toBe("not_group");
  });
  it("link publik: username harus cocok (tanpa membedakan huruf besar)", () => {
    const d = decideVerification({ target: pub, chat: { id: -1005555555555, type: "supergroup", username: "Nama_Grup", title: "Publik" }, botStatus: "administrator" });
    expect(d.status).toBe("verified");
    expect(decideVerification({ target: pub, chat: { id: -1005555555555, type: "supergroup", username: "grup_lain" }, botStatus: "member" }).status).toBe("target_mismatch");
  });
});

describe("grup biasa (bukan supergroup)", () => {
  it("t.me/c/ID dicocokkan dengan grup biasa -ID hanya bila Telegram menyatakan tipenya 'group'", () => {
    const d = decideVerification({ target: priv, chat: { id: -2436417110, type: "group", title: "Nexus trial" }, botStatus: "administrator" });
    expect(d).toEqual({ status: "verified", chatId: "-2436417110", chatTitle: "Nexus trial", chatUsername: null, threadId: null });
  });
  it("ID tanpa -100 dari supergroup/kanal tidak diterima", () => {
    expect(decideVerification({ target: priv, chat: { id: -2436417110, type: "supergroup" }, botStatus: "member" }).status).toBe("target_mismatch");
  });
});

describe("grup forum (topik)", () => {
  it("grup forum: angka pertama pada link menjadi topik tujuan", () => {
    const r = parseTelegramLink("https://t.me/c/2436417110/52942");
    if (!r.ok) throw new Error("fixture");
    const d = decideVerification({ target: r.target, chat: { id: -1002436417110, type: "supergroup", is_forum: true, title: "DTIC Environesia Group" }, botStatus: "administrator" });
    expect(d).toMatchObject({ status: "verified", threadId: 52942 });
  });
  it("grup bukan forum: angka pada link hanya nomor pesan (tanpa topik)", () => {
    expect(decideVerification({ target: priv, chat: { id: -1002436417110, type: "supergroup", is_forum: false }, botStatus: "member" })).toMatchObject({ threadId: null });
  });
  it("topik 1 (General) dan link tanpa angka → tanpa message_thread_id", () => {
    const g = parseTelegramLink("https://t.me/c/2436417110/1");
    const none = parseTelegramLink("https://t.me/c/2436417110");
    if (!g.ok || !none.ok) throw new Error("fixture");
    const forum = { id: -1002436417110, type: "supergroup", is_forum: true };
    expect(decideVerification({ target: g.target, chat: forum, botStatus: "member" })).toMatchObject({ threadId: null });
    expect(decideVerification({ target: none.target, chat: forum, botStatus: "member" })).toMatchObject({ threadId: null });
  });
});
