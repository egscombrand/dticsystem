"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/components/ui/cn";
import { formatAnnotationNumber, normalizeRect, rectToPercentStyle, type AnnotationStatus, type Geometry, type NormRect, type ReviewAnnotation } from "@/lib/review";

/** Warna per status highlight — selalu disertai nomor & label di panel (bukan hanya warna). */
const STATUS_FILL: Record<AnnotationStatus, string> = {
  not_submitted: "bg-[rgb(250_204_21/0.38)] border-[rgb(202_138_4)]",
  waiting_pic: "bg-[rgb(251_146_60/0.35)] border-[rgb(194_65_12)]",
  waiting_clarification: "bg-[rgb(56_189_248/0.35)] border-[rgb(3_105_161)]",
  in_progress: "bg-[rgb(167_139_250/0.35)] border-[rgb(109_40_217)]",
  waiting_check: "bg-[rgb(45_212_191/0.33)] border-[rgb(15_118_110)]",
  done: "bg-[rgb(74_222_128/0.30)] border-[rgb(21_128_61)]",
};

export type DraftHighlight = { kind: "text" | "area"; page: number; geometry: Geometry; quote: string | null };

/** Persegi highlight dalam PERSEN kotak halaman/gambar — ikut skala otomatis saat zoom atau ganti ukuran layar. */
export function HighlightRects({
  annotations,
  activeId,
  draft,
  interactive,
  onPick,
}: {
  annotations: ReviewAnnotation[];
  activeId: string | null;
  draft: Geometry | null;
  interactive: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20" data-testid="highlight-layer">
      {annotations.map((a) =>
        a.geometry?.rects.map((r, i) => (
          <div
            key={`${a.id}-${i}`}
            data-testid={`review-hl-${a.number}`}
            data-annotation-id={a.id}
            data-rect={JSON.stringify([r.x, r.y, r.w, r.h])}
            role={interactive ? "button" : undefined}
            tabIndex={interactive && i === 0 ? 0 : undefined}
            aria-label={i === 0 ? `Highlight ${formatAnnotationNumber(a.number)}` : undefined}
            onClick={interactive ? () => onPick(a.id) : undefined}
            onKeyDown={interactive ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(a.id)) : undefined}
            className={cn("absolute rounded-[2px] border-b-2 mix-blend-multiply", STATUS_FILL[a.status], interactive && "pointer-events-auto cursor-pointer", activeId === a.id && "outline-2 outline-offset-1 outline-accent")}
            style={rectToPercentStyle(r)}
          >
            {i === 0 && (
              <span className="pointer-events-none absolute -top-3 left-0 rounded bg-ink px-1 text-[10px] leading-4 font-semibold text-white">{formatAnnotationNumber(a.number)}</span>
            )}
          </div>
        )),
      )}
      {draft?.rects.map((r, i) => (
        <div key={`draft-${i}`} data-testid="review-draft" className="absolute rounded-[2px] border-2 border-dashed border-accent bg-accent/15" style={rectToPercentStyle(r)} />
      ))}
    </div>
  );
}

/** Lapisan seret untuk highlight AREA (gambar, atau bagian PDF yang tidak dapat dipilih). */
export function AreaCapture({ enabled, onDone }: { enabled: boolean; onDone: (rect: NormRect) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  if (!enabled) return null;

  const point = (e: ReactPointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top, box };
  };
  return (
    <div
      ref={ref}
      data-testid="area-capture"
      className="absolute inset-0 z-30 cursor-crosshair touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = point(e);
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = point(e);
        setDrag({ ...drag, x1: p.x, y1: p.y });
      }}
      onPointerUp={(e) => {
        if (!drag) return;
        const p = point(e);
        const rect = normalizeRect(
          { left: Math.min(drag.x0, p.x), top: Math.min(drag.y0, p.y), width: Math.abs(p.x - drag.x0), height: Math.abs(p.y - drag.y0) },
          { width: p.box.width, height: p.box.height },
        );
        setDrag(null);
        if (rect && rect.w > 0.01 && rect.h > 0.008) onDone(rect);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {drag && (
        <div
          className="absolute border-2 border-dashed border-accent bg-accent/15"
          style={{ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }}
        />
      )}
    </div>
  );
}
