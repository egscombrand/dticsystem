import { describe, expect, it } from "vitest";
import { checkFileBasics, contentMatchesExtension, sanitizeFileName } from "@/lib/files";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0x20)]);

describe("validasi file", () => {
  it("menerima ekstensi yang diizinkan", () => {
    expect(checkFileBasics({ name: "brief.pdf", size: 1000 })).toBeNull();
    expect(checkFileBasics({ name: "LOGO.PNG", size: 1000 })).toBeNull();
  });
  it("menolak ekstensi berbahaya, file kosong, dan file terlalu besar", () => {
    expect(checkFileBasics({ name: "virus.exe", size: 10 })).toMatch(/tidak didukung/);
    expect(checkFileBasics({ name: "a.svg", size: 10 })).toMatch(/tidak didukung/);
    expect(checkFileBasics({ name: "a.pdf", size: 0 })).toMatch(/kosong/);
    expect(checkFileBasics({ name: "a.pdf", size: 11 * 1024 * 1024 })).toMatch(/melebihi/);
  });
  it("memeriksa magic bytes", () => {
    expect(contentMatchesExtension("pdf", bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe(true);
    expect(contentMatchesExtension("pdf", bytes(0x4d, 0x5a))).toBe(false); // EXE disamarkan
    expect(contentMatchesExtension("png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(contentMatchesExtension("jpg", bytes(0xff, 0xd8, 0xff))).toBe(true);
    expect(contentMatchesExtension("docx", bytes(0x50, 0x4b, 0x03, 0x04))).toBe(true);
    expect(contentMatchesExtension("txt", new Uint8Array([0x68, 0x00]))).toBe(false);
  });
  it("membersihkan nama file", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\a\\brief<1>.pdf")).toBe("brief1.pdf");
    expect(sanitizeFileName("...hidden.pdf")).toBe("hidden.pdf");
    expect(sanitizeFileName("")).toBe("file");
  });
});
