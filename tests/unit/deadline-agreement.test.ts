import { describe, expect, it } from "vitest";
import { pendingChange, picCanDecide, type DeadlineEvent, type DeadlineEventKind } from "@/lib/deadline-agreement";
import { checkTransition, type Actor } from "@/lib/workflow";

const pic: Actor = { role: "staff", isAssignee: true };
const admin: Actor = { role: "super_admin", isAssignee: false };
const start = (actor: Actor, deadlineAgreed: boolean | undefined) =>
  checkTransition({ from: "assigned", to: "in_progress", actor, note: null, hasAssignee: true, deadlineAgreed });

const ev = (kind: DeadlineEventKind, proposedDeadline: string | null = null): DeadlineEvent => ({
  kind,
  round: null,
  proposedDeadline,
  previousDeadline: null,
  reason: null,
  actorName: null,
  at: "2026-11-05T00:00:00.000Z",
});

describe("gerbang mulai kerjakan", () => {
  it("PIC ditolak (409) sebelum waktu disepakati, diizinkan setelah sepakat", () => {
    const blocked = start(pic, false);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.status).toBe(409);
    expect(start(pic, true).ok).toBe(true);
  });
  it("tidak memengaruhi pemanggil lama yang tidak mengirim status kesepakatan", () => {
    expect(start(pic, undefined).ok).toBe(true);
  });
  it("Super Admin tetap dapat memulai sebagai tindakan administratif", () => {
    expect(start(admin, false).ok).toBe(true);
  });
  it("transisi lain tidak terdampak (mis. on_hold → in_progress)", () => {
    expect(checkTransition({ from: "on_hold", to: "in_progress", actor: pic, note: null, hasAssignee: true, deadlineAgreed: false }).ok).toBe(true);
  });
});

describe("tahap keputusan PIC", () => {
  it("hanya pemeriksaan awal & setelah pemohon minta penyesuaian", () => {
    expect(picCanDecide("pic_review")).toBe(true);
    expect(picCanDecide("adjustment_requested")).toBe(true);
    expect(picCanDecide("awaiting_requester")).toBe(false);
    expect(picCanDecide("agreed")).toBe(false);
    expect(picCanDecide("escalated")).toBe(false);
  });
});

describe("usulan perubahan setelah sepakat", () => {
  it("usulan terakhir tanpa jawaban = menunggu", () => {
    expect(pendingChange([ev("requester_approved"), ev("change_proposed", "2026-12-01T00:00:00.000Z")])?.proposedDeadline).toBe("2026-12-01T00:00:00.000Z");
  });
  it("sudah dijawab (setuju/tolak) atau diubah admin = tidak ada yang menunggu", () => {
    expect(pendingChange([ev("change_proposed"), ev("change_approved")])).toBeNull();
    expect(pendingChange([ev("change_proposed"), ev("change_rejected")])).toBeNull();
    expect(pendingChange([ev("change_proposed"), ev("admin_changed")])).toBeNull();
    expect(pendingChange([ev("pic_accepted_requested")])).toBeNull();
  });
});
