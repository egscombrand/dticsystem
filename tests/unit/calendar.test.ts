import { describe, expect, it } from "vitest";
import { anchorFromParams, calendarPeriod, mondayOf, sortFromParam, viewFromParam } from "@/lib/calendar";

describe("periode kalender (WIB, minggu mulai Senin)", () => {
  it("minggu: Senin–Minggu untuk tanggal Rabu dan Minggu", () => {
    expect(mondayOf("2026-10-14")).toBe("2026-10-12"); // Rabu
    expect(mondayOf("2026-10-18")).toBe("2026-10-12"); // Minggu
    const w = calendarPeriod("week", "2026-10-14");
    expect([w.fromKey, w.toKey, w.days]).toEqual(["2026-10-12", "2026-10-19", 7]);
    expect(w.prevKey).toBe("2026-10-05");
    expect(w.nextKey).toBe("2026-10-19");
  });
  it("minggu melewati pergantian bulan dan tahun", () => {
    const w = calendarPeriod("week", "2027-01-01"); // Jumat
    expect(w.fromKey).toBe("2026-12-28");
    expect(w.toKey).toBe("2027-01-04");
  });
  it("bulan: tanggal 1 sampai awal bulan berikutnya; Februari kabisat", () => {
    const m = calendarPeriod("month", "2028-02-17");
    expect([m.fromKey, m.toKey, m.days]).toEqual(["2028-02-01", "2028-03-01", 29]);
    expect(m.prevKey).toBe("2028-01-01");
    expect(m.nextKey).toBe("2028-03-01");
  });
  it("hari: satu tanggal, navigasi ±1 hari", () => {
    const d = calendarPeriod("day", "2026-12-31");
    expect([d.fromKey, d.toKey, d.prevKey, d.nextKey, d.days]).toEqual(["2026-12-31", "2027-01-01", "2026-12-30", "2027-01-01", 1]);
  });
  it("daftar memakai satu bulan seperti tampilan bulan", () => {
    expect(calendarPeriod("list", "2026-10-14").fromKey).toBe("2026-10-01");
  });
});

describe("parameter URL kalender", () => {
  it("tanggal valid dipakai; month lama tetap berfungsi; selain itu hari ini", () => {
    expect(anchorFromParams("2026-11-03", undefined, "2026-10-14")).toBe("2026-11-03");
    expect(anchorFromParams(undefined, "2026-11", "2026-10-14")).toBe("2026-11-01");
    expect(anchorFromParams("bukan-tanggal", undefined, "2026-10-14")).toBe("2026-10-14");
  });
  it("tampilan dan urutan tidak dikenal kembali ke default", () => {
    expect(viewFromParam("week")).toBe("week");
    expect(viewFromParam("xyz")).toBe("month");
    expect(sortFromParam("pic")).toBe("pic");
    expect(sortFromParam("drop table")).toBe("deadline");
  });
});
