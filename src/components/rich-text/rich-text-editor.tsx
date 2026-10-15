"use client";

import TextAlign from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Underline as UnderlineIcon,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/components/ui/cn";
import "@/components/rich-text/rich-text.css";
import type { RichDoc } from "@/lib/rich-text";

export type RichTextChange = { json: RichDoc; text: string };

function ToolButton({ icon: Icon, label, active, disabled, onClick }: { icon: LucideIcon; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // pertahankan seleksi di editor
      onClick={onClick}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-40",
        active && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

function Toolbar({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      left: e.isActive({ textAlign: "left" }),
      center: e.isActive({ textAlign: "center" }),
      right: e.isActive({ textAlign: "right" }),
      justify: e.isActive({ textAlign: "justify" }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  const sep = <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />;
  return (
    <div role="toolbar" aria-label="Format teks" className="flex flex-wrap items-center gap-0.5 border-b border-line bg-subtle px-1.5 py-1">
      <ToolButton icon={Bold} label="Tebal (Ctrl+B)" active={s.bold} disabled={disabled} onClick={() => c().toggleBold().run()} />
      <ToolButton icon={Italic} label="Miring (Ctrl+I)" active={s.italic} disabled={disabled} onClick={() => c().toggleItalic().run()} />
      <ToolButton icon={UnderlineIcon} label="Garis bawah (Ctrl+U)" active={s.underline} disabled={disabled} onClick={() => c().toggleUnderline().run()} />
      {sep}
      <ToolButton icon={AlignLeft} label="Rata kiri" active={s.left} disabled={disabled} onClick={() => c().setTextAlign("left").run()} />
      <ToolButton icon={AlignCenter} label="Rata tengah" active={s.center} disabled={disabled} onClick={() => c().setTextAlign("center").run()} />
      <ToolButton icon={AlignRight} label="Rata kanan" active={s.right} disabled={disabled} onClick={() => c().setTextAlign("right").run()} />
      <ToolButton icon={AlignJustify} label="Rata kiri-kanan (justify)" active={s.justify} disabled={disabled} onClick={() => c().setTextAlign("justify").run()} />
      {sep}
      <ToolButton icon={List} label="Daftar berpoin" active={s.bullet} disabled={disabled} onClick={() => c().toggleBulletList().run()} />
      <ToolButton icon={ListOrdered} label="Daftar bernomor" active={s.ordered} disabled={disabled} onClick={() => c().toggleOrderedList().run()} />
      {sep}
      <ToolButton icon={Undo2} label="Urungkan (Ctrl+Z)" disabled={disabled || !s.canUndo} onClick={() => c().undo().run()} />
      <ToolButton icon={Redo2} label="Ulangi (Ctrl+Shift+Z)" disabled={disabled || !s.canRedo} onClick={() => c().redo().run()} />
    </div>
  );
}

/**
 * Editor brief (Tiptap). `immediatelyRender: false` → editor baru dibuat setelah mount,
 * sehingga HTML server dan klien identik (tanpa hydration mismatch) dan SSR halaman tetap aktif.
 */
export function RichTextEditor({
  id,
  initialContent,
  placeholder,
  disabled,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  initialContent?: RichDoc | null;
  placeholder: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: RichTextChange) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        link: false,
      }),
      TextAlign.configure({ types: ["paragraph"], alignments: ["left", "center", "right", "justify"] }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialContent ?? undefined,
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Deskripsi desain",
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(invalid ? { "aria-invalid": "true" } : {}),
        class: `dtic-rich dtic-rich-editor min-h-52 px-3 py-2.5 text-sm leading-relaxed text-ink outline-none`,
      },
    },
    onUpdate: ({ editor: e }) => onChange({ json: e.getJSON() as RichDoc, text: e.getText({ blockSeparator: "\n" }) }),
    onCreate: ({ editor: e }) => onChange({ json: e.getJSON() as RichDoc, text: e.getText({ blockSeparator: "\n" }) }),
  });

  useEffect(() => {
    if (editor && editor.isEditable === !!disabled) editor.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-surface transition-colors focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15",
        invalid ? "border-bad focus-within:border-bad focus-within:ring-bad/15" : "border-line-strong",
        disabled && "bg-subtle",
      )}
    >
      {editor ? (
        <>
          <Toolbar editor={editor} disabled={disabled} />
          <EditorContent editor={editor} />
        </>
      ) : (
        // Placeholder statis dengan ukuran sama selama editor dimuat di browser.
        <div aria-hidden="true">
          <div className="h-[41px] border-b border-line bg-subtle" />
          <div className="min-h-52 px-3 py-2.5 text-sm text-[#9aa1ad]">{placeholder}</div>
        </div>
      )}
    </div>
  );
}
