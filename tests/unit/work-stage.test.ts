import { describe, expect, it } from "vitest";
import { deriveWorkStage } from "@/lib/work-stage";

const base = { orderStatus: "in_progress" as const, qcStatus: "none" as const, hasDraftResults: false, hasEverRequestedRevision: false };

describe("deriveWorkStage", () => {
  it("belum ditugaskan/belum mulai → waiting_start", () => {
    expect(deriveWorkStage({ ...base, orderStatus: "assigned" })).toBe("waiting_start");
    expect(deriveWorkStage({ ...base, orderStatus: "submitted" })).toBe("waiting_start");
  });
  it("sedang dikerjakan tanpa draf → in_progress; dengan draf → draft_result", () => {
    expect(deriveWorkStage({ ...base, orderStatus: "in_progress", hasDraftResults: false })).toBe("in_progress");
    expect(deriveWorkStage({ ...base, orderStatus: "in_progress", hasDraftResults: true })).toBe("draft_result");
  });
  it("Jalur B (Manager): diajukan → pending_review; qcStatus pending + pernah revisi → pending_rereview", () => {
    expect(deriveWorkStage({ ...base, orderStatus: "pending_confirmation", qcStatus: "pending" })).toBe("pending_review");
    expect(deriveWorkStage({ ...base, orderStatus: "pending_confirmation", qcStatus: "pending", hasEverRequestedRevision: true })).toBe("pending_rereview");
  });
  it("Manager minta revisi → needs_revision, terlepas dari qcStatus", () => {
    expect(deriveWorkStage({ ...base, orderStatus: "internal_revision", qcStatus: "revision" })).toBe("needs_revision");
  });
  it("Manager ACC (qcStatus approved) → approved, walau order.status sudah balik ke status lain", () => {
    expect(deriveWorkStage({ ...base, orderStatus: "awaiting_requester", qcStatus: "approved" })).toBe("approved");
    expect(deriveWorkStage({ ...base, orderStatus: "in_progress", qcStatus: "approved" })).toBe("approved");
  });
  it("Jalur A (langsung ke pemohon, TANPA Manager — qcStatus tetap 'none'): menunggu keputusan pemohon → pending_review, BUKAN waiting_start", () => {
    expect(deriveWorkStage({ ...base, orderStatus: "awaiting_requester", qcStatus: "none" })).toBe("pending_review");
  });
  it("Jalur A setelah pemohon minta revisi lalu diajukan ulang → pending_rereview", () => {
    expect(deriveWorkStage({ ...base, orderStatus: "awaiting_requester", qcStatus: "none", hasEverRequestedRevision: true })).toBe("pending_rereview");
  });
  it("selesai/dibatalkan → done, terlepas dari qcStatus", () => {
    expect(deriveWorkStage({ ...base, orderStatus: "completed", qcStatus: "none" })).toBe("done");
    expect(deriveWorkStage({ ...base, orderStatus: "completed", qcStatus: "approved" })).toBe("done");
    expect(deriveWorkStage({ ...base, orderStatus: "cancelled" })).toBe("done");
  });
});
