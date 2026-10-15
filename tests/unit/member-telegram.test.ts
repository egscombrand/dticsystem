import { describe, expect, it } from "vitest";
import { deriveTelegramStatus, normalizeTelegramUserId, normalizeTelegramUsername, pickTelegramRef, telegramNameRequirement } from "@/lib/member-telegram";

describe("normalisasi username & User ID", () => {
  it("username: tanpa @, huruf kecil, spasi dibuang; kosong → null; salah format → invalid", () => {
    expect(normalizeTelegramUsername(" @Andi_Design ")).toBe("andi_design");
    expect(normalizeTelegramUsername("@@budi_s")).toBe("budi_s");
    expect(normalizeTelegramUsername("")).toBeNull();
    expect(normalizeTelegramUsername(undefined)).toBeNull();
    expect(normalizeTelegramUsername("ab")).toBe("invalid");
    expect(normalizeTelegramUsername("1abcde")).toBe("invalid");
    expect(normalizeTelegramUsername("nama spasi")).toBe("invalid");
  });
  it("User ID: numerik; kosong → null; bukan angka atau diawali 0 → invalid", () => {
    expect(normalizeTelegramUserId(" 123456789 ")).toBe("123456789");
    expect(normalizeTelegramUserId("")).toBeNull();
    expect(normalizeTelegramUserId("abc")).toBe("invalid");
    expect(normalizeTelegramUserId("0123")).toBe("invalid");
  });
});

describe("status & kewajiban nama", () => {
  it("tanpa data → belum dihubungkan; ada data → terdata (tidak pernah otomatis terverifikasi)", () => {
    expect(deriveTelegramStatus({ displayName: null, username: null, userId: null })).toBe("not_linked");
    expect(deriveTelegramStatus({ displayName: null, username: "budi_x", userId: null })).toBe("recorded");
    expect(deriveTelegramStatus({ displayName: "Budi", username: null, userId: "42" })).toBe("recorded");
  });
  it("nama Telegram wajib bila ada username atau User ID; tidak wajib bila tanpa data", () => {
    expect(telegramNameRequirement({ displayName: null, username: "budi_x", userId: null })).toMatch(/Nama Telegram/);
    expect(telegramNameRequirement({ displayName: null, username: null, userId: "42" })).toMatch(/Nama Telegram/);
    expect(telegramNameRequirement({ displayName: null, username: null, userId: null })).toBeNull();
    expect(telegramNameRequirement({ displayName: "Siti", username: null, userId: null })).toBeNull();
  });
});

describe("referensi Telegram untuk PIC", () => {
  const base = { fullName: "Andi Saputra", displayName: null, username: null, userId: null, status: "not_linked" as const };
  it("tanpa data → fallback ke nama anggota", () => {
    expect(pickTelegramRef(base)).toEqual({ mode: "fallback", label: "Andi Saputra" });
  });
  it("hanya nama Telegram → tampilkan nama tanpa mention", () => {
    expect(pickTelegramRef({ ...base, displayName: "Andi S", status: "recorded" })).toEqual({ mode: "name", label: "Andi S" });
  });
  it("username saja → informasi @username, bukan mention yang dijamin", () => {
    expect(pickTelegramRef({ ...base, username: "andi_design", status: "recorded" })).toEqual({ mode: "username", username: "andi_design", label: "@andi_design" });
  });
  it("User ID hanya dipakai bila terverifikasi; terdata saja tidak cukup", () => {
    expect(pickTelegramRef({ ...base, userId: "42", status: "recorded" }).mode).not.toBe("user_id");
    expect(pickTelegramRef({ ...base, userId: "42", status: "verified" })).toEqual({ mode: "user_id", userId: "42", label: "Andi Saputra" });
  });
});
