import { describe, expect, it } from "vitest";
import {
  annotationStatusAfterRevision, canSelectForRevision, documentUrl, finalApprovalProblem, formatAnnotationNumber, formatRevisionNumber,
  mergeLineRects, normalizeRect, parseGeometry, previewKindOf, rectToPercentStyle, rectToPixels, revisionSelectionProblem,
  type AnnotationStatus, type NormRect,
} from "@/lib/review";

describe("geometri ternormalisasi", () => {
  it("piksel → 0–1 relatif ke kotak halaman, dan kembali ke piksel pada ukuran BERBEDA (zoom)", () => {
    const n = normalizeRect({ left: 100, top: 50, width: 200, height: 20 }, { width: 800, height: 1000 })!;
    expect([n.x, n.y, n.w, n.h]).toEqual([0.125, 0.05, 0.25, expect.closeTo(0.02, 10)]);
    // Zoom 2×: kotak halaman 1600×2000 → persegi ikut ×2, koordinat ternormalisasi TIDAK berubah.
    const px = rectToPixels(n, { width: 1600, height: 2000 });
    expect([px.left, px.top, px.width]).toEqual([200, 100, 400]);
    expect(px.height).toBeCloseTo(40, 6);
    const css = rectToPercentStyle({ x: 0.125, y: 0.05, w: 0.25, h: 0.02 });
    expect(css).toEqual({ left: "12.5%", top: "5%", width: "25%", height: "2%" });
  });

  it("dijepit ke dalam halaman dan menolak persegi kosong/ukuran nol", () => {
    const n = normalizeRect({ left: -20, top: -20, width: 100, height: 100 }, { width: 400, height: 400 })!;
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
    expect(n.w).toBeCloseTo(0.2);
    expect(normalizeRect({ left: 10, top: 10, width: 0, height: 20 }, { width: 400, height: 400 })).toBeNull();
    expect(normalizeRect({ left: 0, top: 0, width: 10, height: 10 }, { width: 0, height: 400 })).toBeNull();
    expect(normalizeRect({ left: 500, top: 10, width: 20, height: 20 }, { width: 400, height: 400 })).toBeNull();
  });

  it("menggabungkan persegi seleksi yang sebaris dan menempel; baris berbeda tetap terpisah", () => {
    const rects: NormRect[] = [
      { x: 0.1, y: 0.2, w: 0.2, h: 0.02 },
      { x: 0.3, y: 0.2, w: 0.1, h: 0.02 },
      { x: 0.1, y: 0.25, w: 0.3, h: 0.02 },
    ];
    const merged = mergeLineRects(rects);
    expect(merged).toHaveLength(2);
    expect(merged[0].x).toBeCloseTo(0.1);
    expect(merged[0].w).toBeCloseTo(0.3);
  });

  it("parseGeometry: tidak mempercayai klien (batas 0–1, jumlah, tipe, ukuran nol)", () => {
    expect(parseGeometry({ rects: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.1 }] })).toEqual({ rects: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.1 }] });
    expect(parseGeometry(null)).toBeNull();
    expect(parseGeometry({ rects: [] })).toBeNull();
    expect(parseGeometry({ rects: [{ x: 0.9, y: 0.1, w: 0.3, h: 0.1 }] })).toBeNull(); // keluar halaman
    expect(parseGeometry({ rects: [{ x: -0.1, y: 0.1, w: 0.3, h: 0.1 }] })).toBeNull();
    expect(parseGeometry({ rects: [{ x: 0.1, y: 0.1, w: 0, h: 0.1 }] })).toBeNull();
    expect(parseGeometry({ rects: [{ x: "0.1", y: 0.1, w: 0.1, h: 0.1 }] })).toBeNull();
    expect(parseGeometry({ rects: [{ x: 0.1, y: 0.1, w: Number.NaN, h: 0.1 }] })).toBeNull();
    expect(parseGeometry({ rects: Array.from({ length: 81 }, () => ({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 })) })).toBeNull();
  });
});

describe("pemilihan highlight untuk Request Revisi", () => {
  const A = (id: string, number: number, status: AnnotationStatus) => ({ id, number, status });
  const all = [A("a", 1, "not_submitted"), A("b", 2, "not_submitted"), A("c", 3, "not_submitted"), A("d", 4, "waiting_pic"), A("e", 5, "done"), A("f", 6, "waiting_clarification")];

  it("hanya highlight yang belum diajukan yang boleh dipilih", () => {
    expect(canSelectForRevision({ status: "not_submitted" })).toBe(true);
    for (const s of ["waiting_pic", "waiting_clarification", "in_progress", "waiting_check", "done"] as AnnotationStatus[]) expect(canSelectForRevision({ status: s })).toBe(false);
    expect(revisionSelectionProblem(["a", "b", "c"], all)).toBeNull();
  });

  it("menolak: kosong, ganda, tidak dikenal, sudah masuk revisi aktif, sudah selesai, menunggu klarifikasi", () => {
    expect(revisionSelectionProblem([], all)).toMatch(/minimal satu/);
    expect(revisionSelectionProblem(["a", "a"], all)).toMatch(/lebih dari sekali/);
    expect(revisionSelectionProblem(["zzz"], all)).toMatch(/tidak ditemukan/);
    expect(revisionSelectionProblem(["a", "d"], all)).toMatch(/#004.*Menunggu PIC/);
    expect(revisionSelectionProblem(["e"], all)).toMatch(/#005.*Selesai/);
    expect(revisionSelectionProblem(["f"], all)).toMatch(/#006.*Menunggu Klarifikasi/);
  });
});

describe("persetujuan akhir & transisi status highlight", () => {
  it("ditolak selama ada Request Revisi terbuka; boleh bila semua disetujui/diajukan kembali", () => {
    expect(finalApprovalProblem([])).toBeNull();
    expect(finalApprovalProblem([{ number: 1, status: "approved" }, { number: 2, status: "resubmitted" }])).toBeNull();
    for (const status of ["waiting_pic", "in_progress", "waiting_requester_check"] as const) {
      expect(finalApprovalProblem([{ number: 1, status: "approved" }, { number: 2, status }])).toMatch(/REV-002/);
    }
  });

  it("alur status highlight: dibuat → dikerjakan → diserahkan → disetujui; ditolak = dilepas kembali", () => {
    expect(annotationStatusAfterRevision("not_submitted", "created")).toBe("waiting_pic");
    expect(annotationStatusAfterRevision("waiting_pic", "started")).toBe("in_progress");
    expect(annotationStatusAfterRevision("in_progress", "delivered")).toBe("waiting_check");
    expect(annotationStatusAfterRevision("waiting_clarification", "delivered")).toBe("waiting_check");
    expect(annotationStatusAfterRevision("waiting_check", "approved")).toBe("done");
    expect(annotationStatusAfterRevision("waiting_check", "resubmitted")).toBe("not_submitted");
    // Highlight yang tidak ikut revisi tidak pernah berubah.
    expect(annotationStatusAfterRevision("not_submitted", "approved")).toBe("not_submitted");
    expect(annotationStatusAfterRevision("not_submitted", "delivered")).toBe("not_submitted");
    expect(annotationStatusAfterRevision("done", "resubmitted")).toBe("done");
  });
});

describe("format & pembantu", () => {
  it("penomoran dan jenis pratinjau", () => {
    expect(formatAnnotationNumber(7)).toBe("#007");
    expect(formatRevisionNumber(12)).toBe("REV-012");
    expect(previewKindOf("application/pdf", "a.pdf")).toBe("pdf");
    expect(previewKindOf("image/webp", "a.webp")).toBe("image");
    expect(previewKindOf("application/octet-stream", "Deck.PPTX")).toBe("presentation");
    expect(previewKindOf("application/zip", "a.zip")).toBe("none");
  });

  it("URL dokumen selalu lewat endpoint yang memeriksa hak akses", () => {
    expect(documentUrl({ mode: "requester", orderNumber: "DTIC-2026-00001" }, "f1")).toBe("/api/public/tracking/files/f1?order=DTIC-2026-00001&inline=1");
    expect(documentUrl({ mode: "requester", orderNumber: "DTIC-2026-00001" }, "f1", { preview: true })).toBe("/api/public/tracking/preview/f1?order=DTIC-2026-00001");
    expect(documentUrl({ mode: "internal" }, "f1")).toBe("/api/internal/attachments/f1?inline=1");
    expect(documentUrl({ mode: "internal" }, "f1", { preview: true })).toBe("/api/internal/attachments/f1/preview");
  });
});
