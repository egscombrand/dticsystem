import { describe, expect, it } from "vitest";
import { checkResultFileBasics, resultContentMatches } from "@/lib/files";
import { latestResultIds, resultFileHistory } from "@/lib/result-status";

const ev = (kind: string, at: string, ids: string[]) => ({ kind, at, detail: { resultFileIds: ids } });

describe("status file hasil dari peristiwa nyata", () => {
  it("tanpa rujukan = draf; tahap tertinggi menang; riwayat urut waktu", () => {
    const h = resultFileHistory(["a", "b", "c"], [
      ev("delivery_recorded", "2026-10-16T03:00:00Z", ["a"]),
      ev("qc_approved", "2026-10-16T02:00:00Z", ["a"]),
      ev("qc_submitted", "2026-10-16T01:00:00Z", ["a", "b"]),
    ]);
    expect(h.a.stage).toBe("delivered");
    expect(h.a.trail.map((t) => t.label)).toEqual(["Diajukan untuk QC", "Disetujui Manager", "Sudah diserahkan ke pemohon"]);
    expect(h.b.stage).toBe("submitted");
    expect(h.c).toEqual({ stage: "draft", trail: [], usedInCompletion: false });
  });
  it("penyelesaian hanya menandai referensi, bukan pengiriman/persetujuan", () => {
    const h = resultFileHistory(["a"], [ev("completed", "2026-10-16T01:00:00Z", ["a"])]);
    expect(h.a.stage).toBe("draft");
    expect(h.a.usedInCompletion).toBe(true);
  });
  it("file terbaru dari penyerahan/persetujuan terakhir", () => {
    expect(latestResultIds([ev("qc_approved", "2", ["x"]), ev("qc_submitted", "1", ["y"])])).toEqual(["x"]);
    expect(latestResultIds([ev("completed", "2", ["x"])])).toEqual([]);
  });
});

describe("validasi file hasil", () => {
  it("format desain & arsip diterima; lainnya ditolak; ukuran dibatasi", () => {
    expect(checkResultFileBasics({ name: "poster.psd", size: 10 }, 100)).toBeNull();
    expect(checkResultFileBasics({ name: "logo.ai", size: 10 }, 100)).toBeNull();
    expect(checkResultFileBasics({ name: "virus.exe", size: 10 }, 100)).toMatch(/tidak didukung/);
    expect(checkResultFileBasics({ name: "besar.zip", size: 101 }, 100)).toMatch(/melebihi batas/);
    expect(checkResultFileBasics({ name: "kosong.png", size: 0 }, 100)).toMatch(/kosong/);
  });
  it("isi file harus cocok dengan format", () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    expect(resultContentMatches("psd", enc("8BPS\u0000\u0001"))).toBe(true);
    expect(resultContentMatches("psd", enc("bukan psd"))).toBe(false);
    expect(resultContentMatches("ai", enc("%PDF-1.6"))).toBe(true);
    expect(resultContentMatches("ai", enc("%!PS-Adobe"))).toBe(true);
    expect(resultContentMatches("svg", enc('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(true);
    expect(resultContentMatches("svg", enc("<html></html>"))).toBe(false);
    expect(resultContentMatches("zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(resultContentMatches("png", enc("teks biasa"))).toBe(false);
  });
});
