"use client";

import "pdfjs-dist/web/pdf_viewer.css";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { AreaCapture, HighlightRects, type DraftHighlight } from "@/components/review/highlight-layer";
import { Spinner } from "@/components/ui/spinner";
import { mergeLineRects, normalizeRect, type NormRect, type ReviewAnnotation } from "@/lib/review";

/** Worker pdf.js dibundel LOKAL bersama aplikasi (tanpa CDN). Dipakai hanya di browser. */
const WORKER_URL = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;
  return pdfjs;
}

export type PdfViewerProps = {
  src: string;
  /** Pengali ukuran (1 = lebar kolom). */
  zoom: number;
  annotations: ReviewAnnotation[];
  activeAnnotationId: string | null;
  reviewMode: boolean;
  tool: "text" | "area";
  readOnly: boolean;
  draft: DraftHighlight | null;
  /** Halaman yang diminta untuk digulir ke sana (angka berubah = gulir). */
  goToPage: { page: number; nonce: number } | null;
  onDraft: (d: DraftHighlight) => void;
  onPick: (id: string) => void;
  onPageCount: (n: number) => void;
  onCurrentPage: (n: number) => void;
  onLoadError: (message: string) => void;
};

type Size = { w: number; h: number };

export function PdfViewer(props: PdfViewerProps) {
  const { src, zoom, goToPage, onPageCount, onCurrentPage, onLoadError } = props;
  // Callback induk disimpan di ref supaya dokumen TIDAK dimuat ulang bila induk membuat fungsi baru tiap render.
  const callbacks = useRef({ onPageCount, onLoadError });
  useEffect(() => {
    callbacks.current = { onPageCount, onLoadError };
  }, [onPageCount, onLoadError]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [baseWidth, setBaseWidth] = useState(720);

  useEffect(() => {
    let cancelled = false;
    let task: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | null = null;
    const run = async () => {
      setStatus("loading");
      setDoc(null);
      try {
        const pdfjs = await loadPdfjs();
        task = pdfjs.getDocument({ url: src });
        const pdf = await task.promise;
        const dims: Size[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const v = page.getViewport({ scale: 1 });
          dims.push({ w: v.width, h: v.height });
        }
        if (cancelled) return;
        setSizes(dims);
        setDoc(pdf);
        setStatus("ready");
        callbacks.current.onPageCount(pdf.numPages);
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        callbacks.current.onLoadError(e instanceof Error ? e.message : "Dokumen tidak dapat dimuat.");
      }
    };
    void run();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [src]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setBaseWidth(Math.max(280, Math.min(el.clientWidth - 24, 980)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!goToPage) return;
    scrollRef.current?.querySelector(`[data-page-number="${goToPage.page}"]`)?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [goToPage]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    let current = 1;
    el.querySelectorAll<HTMLElement>("[data-page-number]").forEach((p) => {
      if (p.getBoundingClientRect().top - top < el.clientHeight * 0.4) current = Number(p.dataset.pageNumber);
    });
    onCurrentPage(current);
  };

  const displayWidth = baseWidth * zoom;
  return (
    <div ref={scrollRef} onScroll={onScroll} data-testid="pdf-scroll" className="relative max-h-[78vh] min-h-[320px] overflow-auto rounded-xl bg-[#e9ecf0] p-3">
      {status === "loading" && (
        <div className="flex h-60 items-center justify-center gap-2 text-sm text-ink-2" role="status">
          <Spinner className="size-4" /> Memuat dokumen…
        </div>
      )}
      {status === "ready" && doc && (
        <div className="flex flex-col items-center gap-4">
          {sizes.map((size, i) => (
            <PdfPage key={i + 1} doc={doc} pageNumber={i + 1} size={size} displayWidth={displayWidth} {...props} />
          ))}
        </div>
      )}
    </div>
  );
}

function PdfPage({
  doc, pageNumber, size, displayWidth, annotations, activeAnnotationId, reviewMode, tool, readOnly, draft, onDraft, onPick,
}: { doc: PDFDocumentProxy; pageNumber: number; size: Size; displayWidth: number } & PdfViewerProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const height = (displayWidth * size.h) / size.w;

  useEffect(() => {
    const el = boxRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "700px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    const run = async () => {
      const pdfjs = await loadPdfjs();
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: displayWidth / size.w });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      renderTask = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await renderTask.promise;
      const container = textRef.current;
      if (!container || cancelled) return;
      container.replaceChildren();
      await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport }).render();
      if (!cancelled) container.dataset.rendered = "1";
    };
    run().catch(() => {
      /* render dibatalkan (zoom/ukuran berubah) atau halaman gagal — viewer tetap bisa dipakai */
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, displayWidth, size.w, visible]);

  const mine = annotations.filter((a) => a.page === pageNumber && a.geometry);
  const textTool = reviewMode && !readOnly && tool === "text";

  /** Seleksi teks → persegi ternormalisasi (relatif ke kotak halaman yang sedang ditampilkan) + kutipan. */
  const captureSelection = () => {
    if (!textTool) return;
    const sel = window.getSelection();
    const box = boxRef.current?.getBoundingClientRect();
    const layer = textRef.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !box || !layer) return;
    const range = sel.getRangeAt(0);
    if (!layer.contains(range.commonAncestorContainer)) return;
    const rects: NormRect[] = [];
    for (const r of Array.from(range.getClientRects())) {
      const n = normalizeRect({ left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height }, { width: box.width, height: box.height });
      if (n && n.w > 0.002 && n.h > 0.002) rects.push(n);
    }
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (rects.length === 0 || !quote) return;
    sel.removeAllRanges();
    onDraft({ kind: "text", page: pageNumber, geometry: { rects: mergeLineRects(rects).slice(0, 80) }, quote: quote.slice(0, 600) });
  };

  return (
    <div
      ref={boxRef}
      data-testid={`review-page-${pageNumber}`}
      data-page-number={pageNumber}
      onMouseUp={captureSelection}
      className="relative shrink-0 bg-white shadow-card"
      style={{ width: displayWidth, height }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div ref={textRef} className="textLayer absolute inset-0 z-10" data-testid={`review-text-${pageNumber}`} />
      <HighlightRects
        annotations={mine}
        activeId={activeAnnotationId}
        draft={draft && draft.page === pageNumber ? draft.geometry : null}
        interactive={!textTool}
        onPick={onPick}
      />
      <AreaCapture enabled={reviewMode && !readOnly && tool === "area"} onDone={(rect) => onDraft({ kind: "area", page: pageNumber, geometry: { rects: [rect] }, quote: null })} />
    </div>
  );
}
