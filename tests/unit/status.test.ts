import { describe, expect, it } from "vitest";
import { ASSIGNMENT_SLA_HOURS, isAssignmentStale, isOverdue, statusLabel, toCurrentStatus } from "@/lib/status";

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

describe("isAssignmentStale (SLA penugasan, terpisah dari deadline pekerjaan)", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  const longAgo = new Date(now.getTime() - (ASSIGNMENT_SLA_HOURS + 1) * 60 * 60 * 1000).toISOString();
  const recently = new Date(now.getTime() - (ASSIGNMENT_SLA_HOURS - 1) * 60 * 60 * 1000).toISOString();

  it("assigned lebih lama dari SLA, belum mulai dikerjakan → terlambat", () => {
    expect(isAssignmentStale(longAgo, "assigned", now)).toBe(true);
  });
  it("assigned belum melewati SLA → belum terlambat", () => {
    expect(isAssignmentStale(recently, "assigned", now)).toBe(false);
  });
  it("status selain 'assigned' tidak pernah dianggap terlambat SLA ini, walau assignedAt lama", () => {
    for (const s of ["in_progress", "pending_confirmation", "completed", "submitted"] as const) expect(isAssignmentStale(longAgo, s, now)).toBe(false);
  });
  it("tanpa assignedAt (order belum pernah assigned) → tidak terlambat", () => {
    expect(isAssignmentStale(null, "assigned", now)).toBe(false);
  });
});

describe("label & kode status", () => {
  it("label status baru berbahasa Indonesia", () => {
    expect(statusLabel("assigned")).toBe("Siap Dikerjakan");
    expect(statusLabel("pending_confirmation")).toBe("Menunggu QC Manager");
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
