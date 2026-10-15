import type { ReactNode } from "react";
import "@/components/rich-text/rich-text.css";
import { cn } from "@/components/ui/cn";
import { parseRichDoc, plainTextToRichDoc, type RichBlock, type RichInline, type TextAlign } from "@/lib/rich-text";

const ALIGN: Record<TextAlign, string> = { left: "text-left", center: "text-center", right: "text-right", justify: "text-justify" };

function Inline({ nodes }: { nodes?: RichInline[] }) {
  if (!nodes?.length) return <br />;
  return nodes.map((n, i) => {
    if (n.type === "hardBreak") return <br key={i} />;
    let el: ReactNode = n.text; // teks dirender sebagai teks React (ter-escape), bukan HTML
    for (const m of n.marks ?? []) {
      if (m.type === "bold") el = <strong>{el}</strong>;
      else if (m.type === "italic") el = <em>{el}</em>;
      else if (m.type === "underline") el = <u>{el}</u>;
    }
    return <span key={i}>{el}</span>;
  });
}

function Blocks({ blocks }: { blocks: RichBlock[] }) {
  return blocks.map((b, i) => {
    if (b.type === "paragraph")
      return (
        <p key={i} className={b.attrs ? ALIGN[b.attrs.textAlign] : undefined}>
          <Inline nodes={b.content} />
        </p>
      );
    const items = b.content.map((li, j) => (
      <li key={j}>
        <Blocks blocks={li.content} />
      </li>
    ));
    return b.type === "bulletList" ? (
      <ul key={i}>{items}</ul>
    ) : (
      <ol key={i} start={b.attrs?.start}>{items}</ol>
    );
  });
}

/**
 * Menampilkan brief rich text. Dokumen selalu disanitasi ulang sebelum dirender;
 * bila tidak ada dokumen (data lama), teks polos ditampilkan per baris.
 */
export function RichTextView({ doc, fallbackText, className }: { doc: unknown; fallbackText: string; className?: string }) {
  const parsed = doc ? parseRichDoc(doc) : null;
  const safe = parsed?.ok ? parsed.doc : plainTextToRichDoc(fallbackText);
  return (
    <div className={cn("dtic-rich", "text-sm leading-relaxed break-words text-ink", className)}>
      <Blocks blocks={safe.content} />
    </div>
  );
}
