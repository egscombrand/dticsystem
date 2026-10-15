/**
 * Brief rich text: dokumen JSON Tiptap/ProseMirror yang DIBANGUN ULANG dari whitelist.
 * Node, mark, dan atribut di luar daftar dibuang — tidak ada HTML mentah yang disimpan
 * atau dirender, sehingga aman dari XSS. Dipakai bersama oleh browser dan server.
 */

export const TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];
export const MARKS = ["bold", "italic", "underline"] as const;
export type Mark = (typeof MARKS)[number];

export type RichText = { type: "text"; text: string; marks?: { type: Mark }[] };
export type RichHardBreak = { type: "hardBreak" };
export type RichInline = RichText | RichHardBreak;
export type RichParagraph = { type: "paragraph"; attrs?: { textAlign: TextAlign }; content?: RichInline[] };
export type RichListItem = { type: "listItem"; content: RichBlock[] };
export type RichList = { type: "bulletList" | "orderedList"; attrs?: { start: number }; content: RichListItem[] };
export type RichBlock = RichParagraph | RichList;
export type RichDoc = { type: "doc"; content: RichBlock[] };

export const RICH_LIMITS = { maxDepth: 6, maxNodes: 4000, maxPlainChars: 5000 } as const;

type Ctx = { nodes: number };

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function count(ctx: Ctx) {
  if (++ctx.nodes > RICH_LIMITS.maxNodes) throw new Error("too_many_nodes");
}

function cleanInline(raw: unknown, ctx: Ctx): RichInline | null {
  const n = obj(raw);
  if (!n) return null;
  count(ctx);
  if (n.type === "hardBreak") return { type: "hardBreak" };
  if (n.type !== "text" || typeof n.text !== "string" || n.text.length === 0) return null;
  // Buang karakter kontrol selain tab/newline.
  const text = n.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (!text) return null;
  const marks = [...new Set(arr(n.marks).map((m) => obj(m)?.type).filter((t): t is Mark => MARKS.includes(t as Mark)))];
  return marks.length ? { type: "text", text, marks: marks.map((type) => ({ type })) } : { type: "text", text };
}

function cleanParagraph(n: Record<string, unknown>, ctx: Ctx): RichParagraph {
  const align = obj(n.attrs)?.textAlign;
  const content = arr(n.content).map((c) => cleanInline(c, ctx)).filter((c): c is RichInline => c !== null);
  const p: RichParagraph = { type: "paragraph" };
  if (typeof align === "string" && align !== "left" && TEXT_ALIGNS.includes(align as TextAlign)) p.attrs = { textAlign: align as TextAlign };
  if (content.length) p.content = content;
  return p;
}

function cleanBlock(raw: unknown, ctx: Ctx, depth: number): RichBlock | null {
  const n = obj(raw);
  if (!n) return null;
  if (depth > RICH_LIMITS.maxDepth) throw new Error("too_deep");
  count(ctx);
  if (n.type === "paragraph") return cleanParagraph(n, ctx);
  if (n.type === "bulletList" || n.type === "orderedList") {
    const items: RichListItem[] = [];
    for (const it of arr(n.content)) {
      const li = obj(it);
      if (!li || li.type !== "listItem") continue;
      count(ctx);
      const blocks = arr(li.content).map((b) => cleanBlock(b, ctx, depth + 1)).filter((b): b is RichBlock => b !== null);
      items.push({ type: "listItem", content: blocks.length ? blocks : [{ type: "paragraph" }] });
    }
    if (!items.length) return null;
    const list: RichList = { type: n.type, content: items };
    const start = Number(obj(n.attrs)?.start);
    if (n.type === "orderedList" && Number.isInteger(start) && start > 1 && start < 10000) list.attrs = { start };
    return list;
  }
  // Node lain (heading, code, gambar, dll.) → diambil teksnya saja sebagai paragraf.
  const text = plainOf(n).trim();
  return text ? { type: "paragraph", content: [{ type: "text", text }] } : null;
}

function plainOf(n: unknown): string {
  const o = obj(n);
  if (!o) return "";
  if (o.type === "text" && typeof o.text === "string") return o.text;
  return arr(o.content).map(plainOf).join(" ");
}

/** Teks polos untuk pencarian, judul otomatis, dan validasi panjang. */
export function richToPlainText(doc: RichDoc): string {
  const lines: string[] = [];
  const inline = (c: RichInline[] = []) => c.map((i) => (i.type === "text" ? i.text : "\n")).join("");
  const walk = (blocks: RichBlock[], indent: string) => {
    for (const b of blocks) {
      if (b.type === "paragraph") lines.push(indent + inline(b.content));
      else
        b.content.forEach((li, i) => {
          const bullet = b.type === "bulletList" ? "• " : `${(b.attrs?.start ?? 1) + i}. `;
          const [first, ...rest] = li.content;
          if (first?.type === "paragraph") lines.push(indent + bullet + inline(first.content));
          else if (first) walk([first], indent + "  ");
          walk(rest, indent + "  ");
        });
    }
  };
  walk(doc.content, "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type RichParseResult = { ok: true; doc: RichDoc; text: string } | { ok: false; error: string };

/** Validasi + sanitasi dokumen dari klien (string JSON atau objek). */
export function parseRichDoc(input: unknown): RichParseResult {
  let raw: unknown = input;
  if (typeof input === "string") {
    if (input.length > 400_000) return { ok: false, error: "Deskripsi terlalu panjang." };
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, error: "Format deskripsi tidak valid." };
    }
  }
  const root = obj(raw);
  if (!root || root.type !== "doc") return { ok: false, error: "Format deskripsi tidak valid." };
  try {
    const ctx: Ctx = { nodes: 0 };
    const content = arr(root.content).map((b) => cleanBlock(b, ctx, 1)).filter((b): b is RichBlock => b !== null);
    const doc: RichDoc = { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
    const text = richToPlainText(doc);
    if (text.length > RICH_LIMITS.maxPlainChars)
      return { ok: false, error: `Deskripsi maksimal ${RICH_LIMITS.maxPlainChars.toLocaleString("id-ID")} karakter.` };
    return { ok: true, doc, text };
  } catch {
    return { ok: false, error: "Struktur deskripsi terlalu kompleks." };
  }
}

/** Dokumen dari teks polos (data lama / tanpa editor). */
export function plainTextToRichDoc(text: string): RichDoc {
  const content: RichBlock[] = text
    .split(/\r?\n/)
    .map((line): RichParagraph => (line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" }));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
