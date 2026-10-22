import { describe, expect, it } from "vitest";
import { trackingStages } from "@/lib/tracking-labels";
import type { OrderStatus } from "@/lib/status";

const seen = (...s: OrderStatus[]) => new Set(s);

describe("trackingStages (timeline Riwayat Request publik)", () => {
  it("Jalur A — langsung ke pemohon, TANPA Manager: 'Pemeriksaan Internal' TIDAK PERNAH muncul", () => {
    const stages = trackingStages("awaiting_requester", seen("assigned", "in_progress", "awaiting_requester"));
    expect(stages).not.toContain("pending_confirmation");
    expect(stages).toEqual(["assigned", "in_progress", "awaiting_requester", "completed"]);
  });
  it("Jalur A selesai (pemohon setuju, PIC tutup): tetap tanpa Manager di riwayat", () => {
    const stages = trackingStages("completed", seen("assigned", "in_progress", "awaiting_requester", "completed"));
    expect(stages).not.toContain("pending_confirmation");
  });
  it("Jalur B — melalui Manager: 'Pemeriksaan Internal' muncul karena benar-benar pernah terjadi", () => {
    const stages = trackingStages("awaiting_requester", seen("assigned", "in_progress", "pending_confirmation", "awaiting_requester"));
    expect(stages).toContain("pending_confirmation");
    expect(stages.indexOf("pending_confirmation")).toBeLessThan(stages.indexOf("awaiting_requester"));
  });
  it("revisi hanya muncul bila benar-benar pernah terjadi (Jalur A maupun Jalur B)", () => {
    const noRevision = trackingStages("awaiting_requester", seen("assigned", "in_progress", "awaiting_requester"));
    expect(noRevision).not.toContain("internal_revision");
    const withRevision = trackingStages("in_progress", seen("assigned", "in_progress", "pending_confirmation", "internal_revision"));
    expect(withRevision).toContain("internal_revision");
  });
  it("on_hold hanya muncul bila benar-benar pernah terjadi", () => {
    expect(trackingStages("in_progress", seen("assigned", "in_progress"))).not.toContain("on_hold");
    expect(trackingStages("in_progress", seen("assigned", "in_progress", "on_hold"))).toContain("on_hold");
  });
  it("dibatalkan: tahap akhir 'cancelled', bukan 'completed'", () => {
    expect(trackingStages("cancelled", seen("assigned", "cancelled")).at(-1)).toBe("cancelled");
  });
  it("order baru (belum ada PIC): tahap 'submitted' muncul", () => {
    expect(trackingStages("submitted", seen("submitted"))).toContain("submitted");
  });
});
