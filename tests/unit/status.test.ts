import { describe, expect, it } from "vitest";
import { isOverdue, statusLabel, toCurrentStatus } from "@/lib/status";

describe("isOverdue", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  const past = "2026-10-08T10:00:00Z";
  const future = "2026-10-10T10:00:00Z";

  it("order aktif yang lewat deadline = terlambat", () => {
    expect(isOverdue(past, "in_progress", now)).toBe(true);
    expect(isOverdue(past, "assigned", now)).toBe(true);
    expect(isOverdue(past, "on_hold", now)).toBe(true);
  });
  it("Selesai/Dibatalkan tidak pernah terlambat aktif", () => {
    expect(isOverdue(past, "completed", now)).toBe(false);
    expect(isOverdue(past, "cancelled", now)).toBe(false);
  });
  it("deadline di masa depan tidak terlambat", () => {
    expect(isOverdue(future, "pending_confirmation", now)).toBe(false);
  });
});

describe("label & kode status", () => {
  it("label status baru berbahasa Indonesia", () => {
    expect(statusLabel("assigned")).toBe("Siap Dikerjakan");
    expect(statusLabel("pending_confirmation")).toBe("Menunggu Konfirmasi");
    expect(statusLabel("cancelled")).toBe("Dibatalkan");
  });
  it("kode status lama tetap bisa dibaca di riwayat (diberi label '(lama)')", () => {
    expect(statusLabel("review")).toBe("Review (lama)");
    expect(statusLabel("closed")).toBe("Ditutup (lama)");
    expect(statusLabel("kode-asing")).toBe("kode-asing");
  });
  it("status lama dipetakan ke padanan barunya untuk timeline publik", () => {
    expect(toCurrentStatus("need_information")).toBe("on_hold");
    expect(toCurrentStatus("review")).toBe("pending_confirmation");
    expect(toCurrentStatus("closed")).toBe("completed");
    expect(toCurrentStatus("assigned")).toBe("assigned");
    expect(toCurrentStatus("kode-asing")).toBeNull();
  });
});
