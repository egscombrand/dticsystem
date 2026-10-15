import { describe, expect, it } from "vitest";
import { loadLevels, recommendCandidates, type MemberWorkload } from "@/lib/workload";

const w = (memberId: string, active: number, overdue = 0): MemberWorkload => ({
  memberId,
  name: memberId,
  division: "Staff",
  teams: ["Tim"],
  active,
  inProgress: 0,
  pendingConfirmation: 0,
  onHold: 0,
  overdue,
  nearestDeadline: null,
});

describe("loadLevels (indikator komparatif)", () => {
  it("membagi rentang aktif menjadi ringan/sedang/berat", () => {
    expect(loadLevels([w("a", 0), w("b", 3), w("c", 6)])).toEqual({ a: "low", b: "medium", c: "high" });
  });
  it("semua sama → setara (tanpa memaksakan label ringan/berat)", () => {
    expect(loadLevels([w("a", 2), w("b", 2)])).toEqual({ a: "even", b: "even" });
  });
  it("daftar kosong → kosong", () => {
    expect(loadLevels([])).toEqual({});
  });
});

describe("recommendCandidates", () => {
  it("merekomendasikan order aktif paling sedikit, dengan alasan", () => {
    const r = recommendCandidates([w("gilar", 4), w("fathin", 1)]);
    expect(r.kind).toBe("suggest");
    if (r.kind !== "suggest") return;
    expect(r.memberIds).toEqual(["fathin"]);
    expect(r.reasons.fathin).toMatch(/1 order aktif/);
    expect(r.reasons.fathin).toMatch(/maks\. 4/);
    expect(r.reasons.fathin).not.toMatch(/jam kerja|kesulitan|durasi/);
  });
  it("aktif sama → yang tidak punya order terlambat diutamakan", () => {
    const r = recommendCandidates([w("a", 2, 1), w("b", 2, 0)]);
    expect(r.kind === "suggest" && r.memberIds).toEqual(["b"]);
  });
  it("beban setara → tidak ada rekomendasi paksa", () => {
    expect(recommendCandidates([w("a", 2), w("b", 2), w("c", 2)]).kind).toBe("even");
  });
  it("satu atau tanpa kandidat → tidak ada rekomendasi", () => {
    expect(recommendCandidates([w("a", 0)]).kind).toBe("none");
    expect(recommendCandidates([]).kind).toBe("none");
  });
  it("beberapa kandidat sama-sama paling ringan → semuanya direkomendasikan", () => {
    const r = recommendCandidates([w("a", 1), w("b", 1), w("c", 5)]);
    expect(r.kind === "suggest" && r.memberIds).toEqual(["a", "b"]);
  });
});
