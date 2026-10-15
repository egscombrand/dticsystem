import { describe, expect, it } from "vitest";
import { addDaysToKey, dateKeyToUtcStart, daysInMonth, describeDeadline, shiftMonth, toDateKey, toDateTimeLocalValue, weekdayMondayFirst, zonedLocalToUtc } from "@/lib/dates";

describe("zona waktu Asia/Jakarta", () => {
  it("mengonversi waktu dinding WIB ke UTC", () => {
    expect(zonedLocalToUtc("2026-10-15T14:30")?.toISOString()).toBe("2026-10-15T07:30:00.000Z");
    expect(zonedLocalToUtc("2026-01-01T00:00")?.toISOString()).toBe("2025-12-31T17:00:00.000Z");
  });

  it("menolak tanggal tidak valid", () => {
    expect(zonedLocalToUtc("2026-02-31T10:00")).toBeNull();
    expect(zonedLocalToUtc("2026-13-01T10:00")).toBeNull();
    expect(zonedLocalToUtc("bukan tanggal")).toBeNull();
  });

  it("deadline 23:30 WIB tetap di tanggal yang sama (tidak bergeser ke UTC)", () => {
    const d = zonedLocalToUtc("2026-10-15T23:30")!;
    expect(d.getUTCDate()).toBe(15);
    expect(toDateKey(d)).toBe("2026-10-15");
    const early = zonedLocalToUtc("2026-10-16T05:00")!; // 15 Okt 22:00 UTC
    expect(early.getUTCDate()).toBe(15);
    expect(toDateKey(early)).toBe("2026-10-16");
  });

  it("round-trip nilai datetime-local", () => {
    expect(toDateTimeLocalValue(zonedLocalToUtc("2026-12-31T23:59")!)).toBe("2026-12-31T23:59");
  });

  it("awal hari WIB dalam UTC", () => {
    expect(dateKeyToUtcStart("2026-10-01")?.toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });

  it("aritmetika kalender", () => {
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(weekdayMondayFirst(2026, 10, 1)).toBe(3); // Kamis
  });

  it("deskripsi sisa waktu", () => {
    const now = new Date("2026-10-09T00:00:00Z");
    expect(describeDeadline(new Date("2026-10-12T00:00:00Z"), now)).toBe("3 hari lagi");
    expect(describeDeadline(new Date("2026-10-08T21:00:00Z"), now)).toBe("Lewat 3 jam");
  });
});

describe("deadline berbasis tanggal", () => {
  it("tanggal → 23.59 WIB dan ditampilkan tanpa jam", async () => {
    const { dateOnlyDeadlineToUtc, formatDeadline } = await import("@/lib/dates");
    const d = dateOnlyDeadlineToUtc("2026-10-15")!;
    expect(d.toISOString()).toBe("2026-10-15T16:59:00.000Z");
    expect(toDateKey(d)).toBe("2026-10-15");
    expect(formatDeadline(d)).not.toMatch(/WIB/);
    expect(formatDeadline(zonedLocalToUtc("2026-10-15T14:30")!)).toMatch(/WIB/);
    expect(dateOnlyDeadlineToUtc("2026-13-01")).toBeNull();
  });
});
