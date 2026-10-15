import { describe, expect, it } from "vitest";
import { diffDisplay, isNewerResponse } from "@/lib/display-events";

const it1 = (id: string, status: string) => ({ id, status });

describe("deteksi event display", () => {
  it("snapshot pertama adalah baseline: tidak ada event (data lama tidak diputar)", () => {
    const r = diffDisplay(null, [it1("a", "assigned"), it1("b", "in_progress")]);
    expect(r.events).toEqual([]);
    expect([...r.next.keys()]).toEqual(["a", "b"]);
  });
  it("polling dengan data identik tidak menghasilkan event apa pun", () => {
    const base = diffDisplay(null, [it1("a", "assigned")]);
    const r = diffDisplay(base.next, [it1("a", "assigned")]);
    expect(r.events).toEqual([]);
  });
  it("order baru menghasilkan tepat satu event 'new'", () => {
    const base = diffDisplay(null, [it1("a", "assigned")]);
    const r = diffDisplay(base.next, [it1("b", "assigned"), it1("a", "assigned")]);
    expect(r.events.map((e) => [e.kind, e.item.id])).toEqual([["new", "b"]]);
  });
  it("perubahan status menghasilkan event 'status' dengan status asal & tujuan", () => {
    const base = diffDisplay(null, [it1("a", "assigned")]);
    const r = diffDisplay(base.next, [it1("a", "in_progress")]);
    expect(r.events).toEqual([{ kind: "status", item: it1("a", "in_progress"), from: "assigned", to: "in_progress" }]);
  });
  it("perubahan urutan daftar bukan event", () => {
    const base = diffDisplay(null, [it1("a", "assigned"), it1("b", "assigned")]);
    const r = diffDisplay(base.next, [it1("b", "assigned"), it1("a", "assigned")]);
    expect(r.events).toEqual([]);
  });
  it("order yang keluar dari daftar (mis. dibatalkan) tidak menghasilkan event", () => {
    const base = diffDisplay(null, [it1("a", "assigned"), it1("b", "assigned")]);
    expect(diffDisplay(base.next, [it1("a", "assigned")]).events).toEqual([]);
  });
  it("id ganda dalam satu snapshot hanya menghasilkan satu event", () => {
    const base = diffDisplay(null, []);
    const r = diffDisplay(base.next, [it1("x", "assigned"), it1("x", "assigned")]);
    expect(r.events.length).toBe(1);
  });
  it("respons usang tidak boleh menimpa respons yang lebih baru", () => {
    expect(isNewerResponse(5, 6)).toBe(true);
    expect(isNewerResponse(5, 5)).toBe(false);
    expect(isNewerResponse(5, 4)).toBe(false);
  });
});
