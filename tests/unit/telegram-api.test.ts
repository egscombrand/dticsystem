import { describe, expect, it } from "vitest";
import { classifyNetworkError, describeApiFailure, safeLogLine } from "@/lib/telegram-api";
import { telegramErrorMessage } from "@/lib/telegram";

const TOKEN = "123456:AAHtestTokenUjiDTIC-abcdefghijklmnop";

function netErr(code: string, name = "TypeError") {
  return Object.assign(new Error("fetch failed"), { name, cause: Object.assign(new Error(`${code} via https://api.telegram.org/bot${TOKEN}/getChat`), { code }) });
}

describe("klasifikasi galat transport", () => {
  it("timeout, DNS, koneksi, dan TLS dibedakan dari kode kosong", () => {
    expect(classifyNetworkError(netErr("ETIMEDOUT"))).toEqual({ reason: "timeout", code: "ETIMEDOUT" });
    expect(classifyNetworkError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toEqual({ reason: "timeout", code: null });
    expect(classifyNetworkError(netErr("ENOTFOUND")).reason).toBe("dns");
    expect(classifyNetworkError(netErr("ECONNREFUSED")).reason).toBe("connection");
    expect(classifyNetworkError(netErr("UND_ERR_SOCKET")).reason).toBe("connection");
    expect(classifyNetworkError(netErr("UNABLE_TO_VERIFY_LEAF_SIGNATURE")).reason).toBe("tls");
    expect(classifyNetworkError(new Error("aneh")).reason).toBe("unknown");
  });
  it("kode yang bukan format aman tidak dibawa ke log (pesan/URL tidak pernah ikut)", () => {
    const c = classifyNetworkError(netErr("ETIMEDOUT"));
    expect(JSON.stringify(c)).not.toContain(TOKEN);
    expect(classifyNetworkError(netErr("bad code with spaces")).code).toBeNull();
  });
});

describe("pesan untuk pengguna", () => {
  it("galat transport tidak pernah disebut penolakan Telegram atau status 0", () => {
    for (const reason of ["timeout", "dns", "connection", "tls", "unknown"] as const) {
      const msg = describeApiFailure({ ok: false, kind: "network", reason, code: null });
      expect(msg).not.toMatch(/menolak|\(0\)|Respons Telegram: 0/);
      expect(msg.length).toBeGreaterThan(20);
    }
    expect(describeApiFailure({ ok: false, kind: "network", reason: "dns", code: "ENOTFOUND" })).toMatch(/DNS/);
    expect(describeApiFailure({ ok: false, kind: "network", reason: "timeout", code: "ETIMEDOUT" })).toMatch(/tepat waktu/);
  });
  it("respons bukan JSON dan HTTP 200 tanpa ok dilaporkan sebagai respons tidak valid", () => {
    expect(describeApiFailure({ ok: false, kind: "invalid", httpStatus: 200 })).toMatch(/tidak valid \(HTTP 200\)/);
  });
  it("429 menyertakan retry_after; 401 dan 5xx punya pesan sendiri", () => {
    expect(describeApiFailure({ ok: false, kind: "telegram", httpStatus: 429, errorCode: 429, description: "Too Many", retryAfterSeconds: 7 })).toMatch(/7 detik/);
    expect(describeApiFailure({ ok: false, kind: "telegram", httpStatus: 401, errorCode: 401, description: "Unauthorized", retryAfterSeconds: null })).toMatch(/Token bot ditolak/);
    expect(describeApiFailure({ ok: false, kind: "telegram", httpStatus: 502, errorCode: 502, description: "Bad Gateway", retryAfterSeconds: null })).toMatch(/bermasalah/);
  });
  it("kode 0 tidak pernah menghasilkan 'menolak (0)'", () => {
    expect(telegramErrorMessage(0, "")).not.toMatch(/\(0\)|Respons Telegram: 0/);
    expect(telegramErrorMessage(0, "")).toMatch(/Tidak dapat terhubung/);
  });
});

describe("log aman", () => {
  it("baris log memuat metode dan jenis, tanpa token atau URL", () => {
    const lines = [
      safeLogLine("getChat", { ok: false, kind: "network", reason: "timeout", code: "ETIMEDOUT" }),
      safeLogLine("getMe", { ok: false, kind: "telegram", httpStatus: 401, errorCode: 401, description: "Unauthorized", retryAfterSeconds: null }),
      safeLogLine("getChat", { ok: false, kind: "invalid", httpStatus: 200 }),
    ];
    for (const line of lines) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toMatch(/https?:\/\//);
    }
    expect(lines[0]).toContain("jenis=timeout");
    expect(lines[1]).toContain("error_code=401");
  });
});
