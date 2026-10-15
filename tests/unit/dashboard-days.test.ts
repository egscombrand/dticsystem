import { describe, expect, it } from "vitest";
import { dayKeysBetween, dateKeyToUtcStart } from "@/lib/dates";

describe("dayKeysBetween (kunci hari WIB untuk grafik tren)", () => {
  it("menghasilkan setiap hari WIB dari awal (inklusif) sampai akhir (eksklusif), tanpa celah", () => {
    const from = dateKeyToUtcStart("2026-10-01")!;
    const to = dateKeyToUtcStart("2026-10-08")!;
    expect(dayKeysBetween(from, to)).toEqual([
      "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07",
    ]);
  });
  it("satu hari → satu kunci", () => {
    const from = dateKeyToUtcStart("2026-12-31")!;
    expect(dayKeysBetween(from, dateKeyToUtcStart("2027-01-01")!)).toEqual(["2026-12-31"]);
  });
});
