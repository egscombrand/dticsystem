import { describe, expect, it } from "vitest";
import { readBotConfig } from "@/lib/telegram";
import { CHAT_ID_RE, chooseDestination, eventTypeForStatus, maskChatId, TELEGRAM_EVENT_TYPES } from "@/lib/telegram-routing";
import { telegramSettingsSchema, telegramVerifySchema } from "@/lib/validation/telegram-brand";
import { ORDER_STATUSES } from "@/lib/status";

const TOKEN = "123456:AAHtestTokenUjiDTIC-abcdefghijklmnop";
const allOn = Object.fromEntries(TELEGRAM_EVENT_TYPES.map((e) => [e, true]));

describe("pemetaan status ke jenis event", () => {
  it("setiap status menghasilkan tepat satu jenis event yang dikenal", () => {
    for (const s of ORDER_STATUSES) expect(TELEGRAM_EVENT_TYPES).toContain(eventTypeForStatus(s));
  });
  it("status khusus punya event sendiri; status lain = perubahan status umum", () => {
    expect(eventTypeForStatus("pending_confirmation")).toBe("waiting_confirmation");
    expect(eventTypeForStatus("completed")).toBe("completed");
    expect(eventTypeForStatus("on_hold")).toBe("on_hold");
    expect(eventTypeForStatus("cancelled")).toBe("cancelled");
    expect(eventTypeForStatus("in_progress")).toBe("status_changed");
    expect(eventTypeForStatus("assigned")).toBe("status_changed");
  });
});

describe("chat ID", () => {
  it("menerima ID grup, ID pribadi, dan @username; menolak spasi dan format lain", () => {
    expect(CHAT_ID_RE.test("-1001234567890")).toBe(true);
    expect(CHAT_ID_RE.test("123456789")).toBe(true);
    expect(CHAT_ID_RE.test("@dtic_grup")).toBe(true);
    expect(CHAT_ID_RE.test("chat dengan spasi")).toBe(false);
    expect(CHAT_ID_RE.test("-100-123")).toBe(false);
    expect(CHAT_ID_RE.test("")).toBe(false);
  });
  it("tampilan tersamarkan hanya memperlihatkan sedikit karakter", () => {
    expect(maskChatId("-1001234567890")).toBe("••••7890");
    expect(maskChatId("@dtic_grup")).toBe("@d••••");
    expect(maskChatId("-1001234567890")).not.toContain("1001234");
  });
});

describe("skema konfigurasi brand", () => {
  it("pengaturan: menerima isActive & jenis event lengkap; menolak chat ID manual", () => {
    expect(telegramSettingsSchema.safeParse({ isActive: true, events: allOn }).success).toBe(true);
    expect(telegramSettingsSchema.safeParse({ isActive: true, events: allOn, chatId: "-1001234567890" }).success).toBe(false);
    expect(telegramSettingsSchema.safeParse({ isActive: true, events: { new_order: true } }).success).toBe(false);
  });
  it("verifikasi: menerima link; menolak field chat ID dari klien", () => {
    expect(telegramVerifySchema.safeParse({ link: "https://t.me/c/2436417110/9467" }).success).toBe(true);
    expect(telegramVerifySchema.safeParse({ link: "https://t.me/c/2436417110/9467", replace: true }).success).toBe(true);
    expect(telegramVerifySchema.safeParse({ link: "https://t.me/x", chatId: "-1001234567890" }).success).toBe(false);
  });
});

describe("konfigurasi bot", () => {
  it("token wajib; chat tidak diperlukan (tujuan ada per brand)", () => {
    expect(readBotConfig({})).toBeNull();
    expect(readBotConfig({ TELEGRAM_BOT_TOKEN: TOKEN })?.token).toBe(TOKEN);
    expect(readBotConfig({ TELEGRAM_BOT_TOKEN: "bukan-token" })).toBeNull();
    expect(readBotConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: "http://evil.example" })).toBeNull();
  });
});

describe("tujuan: satu grup global untuk semua brand", () => {
  it("grup global aktif → kirim (brand tidak ikut menentukan)", () => {
    expect(chooseDestination({ group: "ok", eventType: "new_order" })).toBe("send");
    expect(chooseDestination({ group: "ok", eventType: "completed" })).toBe("send");
  });
  it("grup global belum ada / nonaktif / belum terverifikasi: pengajuan baru menunggu tujuan; event status dilewati", () => {
    for (const group of ["no_channel", "inactive", "unverified"] as const) {
      expect(chooseDestination({ group, eventType: "new_order" })).toBe("await");
      expect(chooseDestination({ group, eventType: "status_changed" })).toBe("skip");
    }
  });
  it("jenis event dimatikan → dilewati", () => {
    expect(chooseDestination({ group: "event_disabled", eventType: "new_order" })).toBe("skip");
  });
});
