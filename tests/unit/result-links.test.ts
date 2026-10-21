import { describe, expect, it } from "vitest";
import { resultLinkSchema } from "@/lib/validation/result-links";

describe("resultLinkSchema", () => {
  it("menerima URL https, judul, dan keterangan opsional", () => {
    const r = resultLinkSchema.parse({ url: "https://contoh.com/situs", title: "Website hasil" });
    expect(r.url).toBe("https://contoh.com/situs");
    expect(r.title).toBe("Website hasil");
    expect(r.description).toBeNull();
  });
  it("keterangan kosong → null; keterangan terisi → tersimpan", () => {
    expect(resultLinkSchema.parse({ url: "https://contoh.com", title: "x", description: "" }).description).toBeNull();
    expect(resultLinkSchema.parse({ url: "https://contoh.com", title: "x", description: "Repo sumber" }).description).toBe("Repo sumber");
  });
  it("menolak URL http (non-https)", () => {
    expect(() => resultLinkSchema.parse({ url: "http://contoh.com", title: "x" })).toThrow();
  });
  it("menolak URL yang tidak valid", () => {
    expect(() => resultLinkSchema.parse({ url: "bukan-url", title: "x" })).toThrow();
  });
  it("menolak judul kosong atau melebihi batas", () => {
    expect(() => resultLinkSchema.parse({ url: "https://contoh.com", title: "" })).toThrow();
    expect(() => resultLinkSchema.parse({ url: "https://contoh.com", title: "a".repeat(201) })).toThrow();
  });
  it("menolak keterangan melebihi batas", () => {
    expect(() => resultLinkSchema.parse({ url: "https://contoh.com", title: "x", description: "a".repeat(1001) })).toThrow();
  });
});
