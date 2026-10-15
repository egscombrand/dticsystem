import { describe, expect, it } from "vitest";
import { parseRichDoc, plainTextToRichDoc, richToPlainText } from "@/lib/rich-text";
import { MASTER_SCHEMAS } from "@/lib/master-data";

describe("parseRichDoc — sanitasi whitelist", () => {
  it("mempertahankan bold/italic/underline, perataan, dan list", () => {
    const r = parseRichDoc({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "Judul", marks: [{ type: "bold" }, { type: "underline" }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Satu", marks: [{ type: "italic" }] }] }] }] },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Tiga" }] }] }] },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.content[0]).toEqual({ type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "Judul", marks: [{ type: "bold" }, { type: "underline" }] }] });
    expect(r.text).toBe("Judul\n• Satu\n3. Tiga");
  });

  it("membuang node/mark/atribut berbahaya atau tidak dikenal", () => {
    const r = parseRichDoc({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { textAlign: "left; background:url(x)", onclick: "alert(1)", style: "x" }, content: [
          { type: "text", text: "<img src=x onerror=alert(1)>", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "bold" }] },
        ] },
        { type: "image", attrs: { src: "https://evil/x.png" } },
        { type: "heading", content: [{ type: "text", text: "Heading jadi paragraf" }] },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = JSON.stringify(r.doc);
    expect(json).not.toMatch(/onclick|javascript|style|image|link|evil/);
    expect(r.doc.content[0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>", marks: [{ type: "bold" }] }] });
    expect(r.doc.content).toHaveLength(2);
    expect(r.text).toContain("Heading jadi paragraf");
  });

  it("menolak dokumen bukan doc, terlalu dalam, atau terlalu panjang", () => {
    expect(parseRichDoc({ type: "paragraph" }).ok).toBe(false);
    expect(parseRichDoc("<p>html</p>").ok).toBe(false);
    let deep: Record<string, unknown> = { type: "paragraph", content: [{ type: "text", text: "x" }] };
    for (let i = 0; i < 10; i++) deep = { type: "bulletList", content: [{ type: "listItem", content: [deep] }] };
    expect(parseRichDoc({ type: "doc", content: [deep] }).ok).toBe(false);
    expect(parseRichDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a".repeat(5001) }] }] }).ok).toBe(false);
  });

  it("teks polos ↔ dokumen", () => {
    expect(richToPlainText(plainTextToRichDoc("baris 1\nbaris 2"))).toBe("baris 1\nbaris 2");
  });
});

describe("skema data master", () => {
  it("prioritas: kode valid, warna dari daftar", () => {
    expect(MASTER_SCHEMAS.priorities.safeParse({ code: "urgent", name: "Urgent", tone: "danger", isActive: true }).success).toBe(true);
    expect(MASTER_SCHEMAS.priorities.safeParse({ code: "Urgent!", name: "Urgent", tone: "danger", isActive: true }).success).toBe(false);
    expect(MASTER_SCHEMAS.priorities.safeParse({ name: "Urgent", tone: "pink", isActive: true }).success).toBe(false);
  });
  it("member: email opsional tervalidasi, divisi wajib uuid", () => {
    const base = { fullName: "Nuri Khusnaini", departmentId: "6c1b2a8e-3f4d-4e5a-9b6c-7d8e9f0a1b2c", position: "Staff", isActive: true };
    expect(MASTER_SCHEMAS.members.parse({ ...base, email: "" }).email).toBeNull();
    expect(MASTER_SCHEMAS.members.safeParse({ ...base, email: "bukan-email" }).success).toBe(false);
    expect(MASTER_SCHEMAS.members.safeParse({ ...base, departmentId: "creative" }).success).toBe(false);
    expect(MASTER_SCHEMAS.members.safeParse({ ...base, role: "admin" }).success).toBe(false);
  });
});
