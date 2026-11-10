import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingHint } from "@/components/ui/loading-hint";
import { LOADING_COPY, loadingStage, SLOW_AFTER_MS, VERY_SLOW_AFTER_MS } from "@/lib/loading-stage";

describe("loadingStage", () => {
  it("normal sebelum batas lambat, lalu lambat, lalu sangat lambat", () => {
    expect(loadingStage(0)).toBe("normal");
    expect(loadingStage(SLOW_AFTER_MS - 1)).toBe("normal");
    expect(loadingStage(SLOW_AFTER_MS)).toBe("slow");
    expect(loadingStage(VERY_SLOW_AFTER_MS - 1)).toBe("slow");
    expect(loadingStage(VERY_SLOW_AFTER_MS)).toBe("very_slow");
    expect(loadingStage(60_000)).toBe("very_slow");
  });

  it("setiap tahap punya pesan berbeda; tahap sangat lambat menenangkan dan menawarkan jalan keluar", () => {
    expect(new Set(Object.values(LOADING_COPY)).size).toBe(3);
    expect(LOADING_COPY.very_slow).toMatch(/Data Anda aman/);
    expect(LOADING_COPY.very_slow).toMatch(/muat ulang/i);
  });
});

describe("LoadingHint (render awal)", () => {
  it("tampil sebagai status dengan label dan pesan tahap awal, tanpa tombol muat ulang", () => {
    const html = renderToStaticMarkup(createElement(LoadingHint, { label: "Memuat detail order…" }));
    expect(html).toContain('role="status"');
    expect(html).toContain('data-stage="normal"');
    expect(html).toContain("Memuat detail order…");
    expect(html).toContain(LOADING_COPY.normal);
    expect(html).not.toContain("Muat ulang halaman");
  });
});
