"use client";

import { ExternalLink, Info } from "lucide-react";
import { useState } from "react";
import { AreaCapture, HighlightRects, type DraftHighlight } from "@/components/review/highlight-layer";
import { Button } from "@/components/ui/button";
import type { ReviewAnnotation } from "@/lib/review";

/** Gambar (PNG/JPG/WEBP): zoom + highlight area. Koordinat dalam persen kotak gambar → tetap akurat saat zoom. */
export function ImageViewer({
  src, alt, zoom, annotations, activeAnnotationId, reviewMode, readOnly, draft, onDraft, onPick, onLoadError,
}: {
  src: string; alt: string; zoom: number; annotations: ReviewAnnotation[]; activeAnnotationId: string | null; reviewMode: boolean;
  readOnly: boolean; draft: DraftHighlight | null; onDraft: (d: DraftHighlight) => void; onPick: (id: string) => void; onLoadError: (m: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const mine = annotations.filter((a) => a.geometry);
  return (
    <div data-testid="image-scroll" className="max-h-[78vh] min-h-[240px] overflow-auto rounded-xl bg-[#e9ecf0] p-3">
      <div data-testid="image-box" className="relative mx-auto bg-white shadow-card" style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: zoom <= 1 ? 980 : undefined }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- berkas dari endpoint terproteksi (bukan aset statis) */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => onLoadError("Gambar tidak dapat dimuat.")}
          className="block h-auto w-full select-none"
        />
        {loaded && (
          <>
            <HighlightRects annotations={mine} activeId={activeAnnotationId} draft={draft?.geometry ?? null} interactive={!(reviewMode && !readOnly)} onPick={onPick} />
            <AreaCapture enabled={reviewMode && !readOnly} onDone={(rect) => onDraft({ kind: "area", page: 1, geometry: { rects: [rect] }, quote: null })} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Tautan eksternal (Canva, website, dokumen online). DTIC Nexus TIDAK dapat membaca atau menganotasi isi
 * halaman eksternal; yang tersedia: membuka tautan dan mencatat referensi manual (halaman/slide/kalimat).
 * Menyematkan (iframe) hanya dicoba bila pengguna memintanya — banyak platform (termasuk Canva) memblokirnya.
 */
export function LinkViewer({ title, url }: { title: string; url: string }) {
  const [embed, setEmbed] = useState(false);
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = url;
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-subtle p-4" data-testid="link-viewer">
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] break-all text-ink-2">{host}</p>
      </div>
      <p className="flex items-start gap-2 text-[13px] text-ink-2">
        <Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden="true" />
        Isi tautan eksternal tidak dapat dianotasi langsung di DTIC Nexus. Buka tautannya, lalu catat bagian yang dimaksud
        (halaman, slide, atau kalimat) sebagai referensi manual — referensi itu tersimpan sebagai highlight dan dapat dimasukkan ke Request Revisi.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle">
          <ExternalLink className="size-4" aria-hidden="true" /> Buka tautan di tab baru
        </a>
        <Button size="sm" variant="ghost" onClick={() => setEmbed((v) => !v)} aria-pressed={embed}>
          {embed ? "Sembunyikan pratinjau tersemat" : "Coba tampilkan di sini"}
        </Button>
      </div>
      {embed && (
        <div>
          <iframe title={`Pratinjau ${title}`} src={url} sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="no-referrer" className="h-[420px] w-full rounded-lg border border-line bg-white" />
          <p className="mt-1 text-[12px] text-ink-3">Bila kosong atau menampilkan galat, platform tersebut tidak mengizinkan penyematan — gunakan tombol &ldquo;Buka tautan di tab baru&rdquo;.</p>
        </div>
      )}
    </div>
  );
}
