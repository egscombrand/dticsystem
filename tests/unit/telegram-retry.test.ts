import { describe, expect, it } from "vitest";
import { classifyFailure, decideAfterAttempt, delayAfterAttempt, MAX_ATTEMPTS, retryDelaysSeconds } from "@/lib/telegram-retry";

describe("jadwal retry", () => {
  it("jadwal default 3, 10, 30, 60 detik; total maksimal 5 percobaan", () => {
    expect(MAX_ATTEMPTS).toBe(5);
    expect([1, 2, 3, 4].map((n) => delayAfterAttempt(n))).toEqual([3, 10, 30, 60]);
    expect(delayAfterAttempt(5)).toBeNull();
    expect(delayAfterAttempt(0)).toBeNull();
  });
  it("env jadwal valid dipakai; tidak valid kembali ke default", () => {
    expect(retryDelaysSeconds({ TELEGRAM_RETRY_DELAYS_SECONDS: "1,2,3,4" })).toEqual([1, 2, 3, 4]);
    expect(retryDelaysSeconds({ TELEGRAM_RETRY_DELAYS_SECONDS: "1,2" })).toEqual([3, 10, 30, 60]);
    expect(retryDelaysSeconds({ TELEGRAM_RETRY_DELAYS_SECONDS: "a,b,c,d" })).toEqual([3, 10, 30, 60]);
    expect(retryDelaysSeconds({})).toEqual([3, 10, 30, 60]);
  });
});

describe("klasifikasi galat", () => {
  it("timeout/jaringan, 429, dan 5xx sementara", () => {
    expect(classifyFailure({ network: true })).toBe("transient");
    expect(classifyFailure({ errorCode: 429 })).toBe("transient");
    expect(classifyFailure({ errorCode: 500 })).toBe("transient");
    expect(classifyFailure({ errorCode: 502 })).toBe("transient");
  });
  it("token, chat, dan izin salah bersifat permanen", () => {
    expect(classifyFailure({ errorCode: 401 })).toBe("permanent");
    expect(classifyFailure({ errorCode: 404 })).toBe("permanent");
    expect(classifyFailure({ errorCode: 400 })).toBe("permanent");
    expect(classifyFailure({ errorCode: 403 })).toBe("permanent");
  });
});

describe("keputusan setelah percobaan", () => {
  it("berhasil → sent", () => {
    expect(decideAfterAttempt({ ok: true, attemptsDone: 1 })).toEqual({ status: "sent" });
  });
  it("galat permanen → failed langsung pada percobaan pertama (tanpa retry)", () => {
    expect(decideAfterAttempt({ ok: false, attemptsDone: 1, kind: "permanent" })).toEqual({ status: "failed", errorKind: "permanent" });
  });
  it("galat sementara → retrying dengan jeda terjadwal", () => {
    expect(decideAfterAttempt({ ok: false, attemptsDone: 1, kind: "transient" })).toEqual({ status: "retrying", errorKind: "transient", delaySeconds: 3 });
    expect(decideAfterAttempt({ ok: false, attemptsDone: 4, kind: "transient" })).toEqual({ status: "retrying", errorKind: "transient", delaySeconds: 60 });
  });
  it("percobaan kelima gagal sementara → failed (habis)", () => {
    expect(decideAfterAttempt({ ok: false, attemptsDone: 5, kind: "transient" })).toEqual({ status: "failed", errorKind: "transient" });
  });
  it("429 dengan retry_after lebih panjang dari jadwal → mengikuti retry_after", () => {
    expect(decideAfterAttempt({ ok: false, attemptsDone: 1, kind: "transient", retryAfterSeconds: 20 })).toEqual({ status: "retrying", errorKind: "transient", delaySeconds: 20 });
    expect(decideAfterAttempt({ ok: false, attemptsDone: 1, kind: "transient", retryAfterSeconds: 1 })).toEqual({ status: "retrying", errorKind: "transient", delaySeconds: 3 });
  });
  it("skenario gagal dua kali lalu berhasil: percobaan ketiga sent", () => {
    const a = decideAfterAttempt({ ok: false, attemptsDone: 1, kind: "transient" });
    const b = decideAfterAttempt({ ok: false, attemptsDone: 2, kind: "transient" });
    const c = decideAfterAttempt({ ok: true, attemptsDone: 3 });
    expect([a.status, b.status, c.status]).toEqual(["retrying", "retrying", "sent"]);
  });
});
