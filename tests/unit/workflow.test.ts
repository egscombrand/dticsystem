import { describe, expect, it } from "vitest";
import { allowedTransitions, checkTransition, type Actor } from "@/lib/workflow";

const pic: Actor = { role: "staff", isAssignee: true };
const otherStaff: Actor = { role: "staff", isAssignee: false };
const manager: Actor = { role: "manager", isAssignee: false };
const admin: Actor = { role: "super_admin", isAssignee: false };
const go = (from: Parameters<typeof checkTransition>[0]["from"], to: Parameters<typeof checkTransition>[0]["to"], actor: Actor = pic, note: string | null = null, hasAssignee = true) =>
  checkTransition({ from, to, actor, note, hasAssignee });

describe("alur normal oleh PIC", () => {
  it("assigned → in_progress → pending_confirmation diizinkan untuk PIC", () => {
    expect(go("assigned", "in_progress").ok).toBe(true);
    expect(go("in_progress", "pending_confirmation").ok).toBe(true);
  });
  it("PIC tidak bisa mengonfirmasi selesai, meminta revisi, atau membatalkan", () => {
    expect(go("pending_confirmation", "completed")).toMatchObject({ ok: false, status: 403 });
    expect(go("pending_confirmation", "in_progress", pic, "revisi")).toMatchObject({ ok: false, status: 403 });
    expect(go("assigned", "cancelled", pic, "alasan")).toMatchObject({ ok: false, status: 403 });
  });
  it("Super Admin mengonfirmasi selesai", () => {
    expect(go("pending_confirmation", "completed", admin).ok).toBe(true);
  });
});

describe("transisi tambahan & alasan wajib", () => {
  it("tunda wajib alasan; lanjutkan tanpa alasan", () => {
    expect(go("in_progress", "on_hold")).toMatchObject({ ok: false, status: 422, field: "note" });
    expect(go("in_progress", "on_hold", pic, "Menunggu aset logo").ok).toBe(true);
    expect(go("on_hold", "in_progress").ok).toBe(true);
  });
  it("revisi wajib catatan; batal wajib alasan", () => {
    expect(go("pending_confirmation", "in_progress", admin)).toMatchObject({ ok: false, status: 422 });
    expect(go("pending_confirmation", "in_progress", admin, "Warna kurang kontras").ok).toBe(true);
    expect(go("in_progress", "cancelled", admin)).toMatchObject({ ok: false, status: 422 });
    expect(go("in_progress", "cancelled", admin, "Dibatalkan pemohon").ok).toBe(true);
  });
  it("lompatan & status akhir ditolak (409)", () => {
    expect(go("assigned", "completed", admin)).toMatchObject({ ok: false, status: 409 });
    expect(go("completed", "in_progress", admin)).toMatchObject({ ok: false, status: 409 });
    expect(go("cancelled", "assigned", admin)).toMatchObject({ ok: false, status: 409 });
  });
  it("submitted → assigned hanya bila sudah ada PIC", () => {
    expect(go("submitted", "assigned", admin, null, false)).toMatchObject({ ok: false, status: 422 });
    expect(go("submitted", "assigned", admin, null, true).ok).toBe(true);
  });
});

describe("pelaku", () => {
  it("Staff lain (bukan PIC) tidak bisa mengubah status", () => {
    expect(go("assigned", "in_progress", otherStaff)).toMatchObject({ ok: false, status: 403 });
    expect(allowedTransitions("assigned", otherStaff)).toEqual([]);
  });
  it("Manager tidak bisa mengubah status apa pun", () => {
    expect(go("assigned", "in_progress", manager)).toMatchObject({ ok: false, status: 403 });
    for (const s of ["submitted", "assigned", "in_progress", "pending_confirmation", "on_hold"] as const) {
      expect(allowedTransitions(s, manager)).toEqual([]);
    }
  });
  it("tombol aksi sesuai pelaku", () => {
    expect(allowedTransitions("in_progress", pic).map((t) => t.to).sort()).toEqual(["on_hold", "pending_confirmation"]);
    expect(allowedTransitions("in_progress", admin).map((t) => t.to).sort()).toEqual(["cancelled", "on_hold", "pending_confirmation"]);
  });
});
