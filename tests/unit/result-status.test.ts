import { describe, expect, it } from "vitest";
import { checkResultFileBasics, resultContentMatches } from "@/lib/files";
import { awaitingPicClosure, hasSubmittedToRequester, latestResultIds, latestResultLinkIds, resultFileHistory, resultLinksUsed } from "@/lib/result-status";

const ev = (kind: string, at: string, ids: string[]) => ({ kind, at, detail: { resultFileIds: ids } });
const evLink = (kind: string, at: string, ids: string[]) => ({ kind, at, detail: { resultLinkIds: ids } });

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

describe("link hasil dari peristiwa nyata", () => {
  it("link terbaru dari penyerahan/persetujuan terakhir", () => {
    expect(latestResultLinkIds([evLink("qc_approved", "2", ["l1"]), evLink("qc_submitted", "1", ["l2"])])).toEqual(["l1"]);
    expect(latestResultLinkIds([evLink("completed", "2", ["l1"])])).toEqual([]);
    expect(latestResultLinkIds([])).toEqual([]);
  });
  it("link yang pernah dirujuk di peristiwa penyerahan/persetujuan ditandai terpakai", () => {
    const used = resultLinksUsed(["l1", "l2"], [evLink("qc_submitted", "1", ["l1"])]);
    expect(used).toEqual({ l1: true, l2: false });
  });
  it("link tanpa rujukan apa pun tetap belum terpakai", () => {
    expect(resultLinksUsed(["l1"], [])).toEqual({ l1: false });
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

describe("awaitingPicClosure (QC Pemohon disetujui ≠ pekerjaan ditutup otomatis)", () => {
  const fb = (at: string, needsRevision: boolean) => ({ kind: "feedback_recorded", at, needsRevision });

  it("pemohon menyetujui (tidak ada revisi) & order belum selesai → menunggu penyelesaian PIC", () => {
    expect(awaitingPicClosure([fb("2026-10-20T10:00:00Z", false)], false)).toBe(true);
  });
  it("pemohon minta revisi → BUKAN menunggu penyelesaian (masih perlu dikerjakan ulang)", () => {
    expect(awaitingPicClosure([fb("2026-10-20T10:00:00Z", true)], false)).toBe(false);
  });
  it("belum ada masukan pemohon sama sekali → bukan menunggu penyelesaian", () => {
    expect(awaitingPicClosure([], false)).toBe(false);
  });
  it("order SUDAH selesai (PIC sudah menutup) → tidak lagi menunggu, terlepas dari peristiwa", () => {
    expect(awaitingPicClosure([fb("2026-10-20T10:00:00Z", false)], true)).toBe(false);
  });
  it("memakai masukan TERBARU secara kronologis, bukan urutan array", () => {
    expect(awaitingPicClosure([fb("2026-10-20T12:00:00Z", false), fb("2026-10-20T10:00:00Z", true)], false)).toBe(true);
    expect(awaitingPicClosure([fb("2026-10-20T10:00:00Z", false), fb("2026-10-20T12:00:00Z", true)], false)).toBe(false);
  });
});

describe("hasSubmittedToRequester (ACC Manager ≠ sudah diajukan ke pemohon)", () => {
  const approved = (at: string) => ({ kind: "qc_approved", at });
  const delivered = (at: string) => ({ kind: "delivery_recorded", at });

  it("ACC Manager SENDIRIAN, belum ada pengajuan ke pemohon → belum diajukan", () => {
    expect(hasSubmittedToRequester([approved("2026-10-21T10:00:00Z")])).toBe(false);
  });
  it("ACC Manager lalu PIC mengajukan ke pemohon → sudah diajukan", () => {
    expect(hasSubmittedToRequester([approved("2026-10-21T10:00:00Z"), delivered("2026-10-21T11:00:00Z")])).toBe(true);
  });
  it("Jalur A (langsung ke pemohon, tanpa ACC Manager sama sekali) → pengajuan langsung dihitung", () => {
    expect(hasSubmittedToRequester([delivered("2026-10-21T10:00:00Z")])).toBe(true);
  });
  it("tidak ada peristiwa apa pun → belum diajukan", () => {
    expect(hasSubmittedToRequester([])).toBe(false);
  });
  it("pengajuan LAMA dari siklus sebelum ACC terbaru tidak dihitung (revisi lalu ACC ulang, belum diajukan lagi)", () => {
    expect(
      hasSubmittedToRequester([
        delivered("2026-10-20T09:00:00Z"), // pengajuan siklus lama
        approved("2026-10-21T10:00:00Z"), // ACC siklus BARU (setelah revisi)
      ]),
    ).toBe(false);
  });
});
