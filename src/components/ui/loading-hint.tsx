"use client";

import { CloudDownload, Hourglass, RotateCw, Timer, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { LOADING_COPY, loadingStage, SLOW_AFTER_MS, VERY_SLOW_AFTER_MS, type LoadingStage } from "@/lib/loading-stage";

/**
 * Kartu status memuat di atas kerangka (skeleton): bingkai gradien yang berputar, penanda orbit berdenyut,
 * judul dengan titik bergerak, dan penjelasan yang berubah menurut lamanya menunggu — dengan tombol muat ulang
 * bila sangat lambat. Animasi hanya menandakan "sedang bekerja": tidak ada persentase atau langkah buatan.
 * Menghormati preferensi pengurangan gerak (lihat globals.css).
 */
const STAGE_ICON: Record<LoadingStage, LucideIcon> = { normal: CloudDownload, slow: Hourglass, very_slow: Timer };

export function LoadingHint({ label }: { label: string }) {
  const [stage, setStage] = useState<LoadingStage>("normal");
  useEffect(() => {
    const slow = window.setTimeout(() => setStage(loadingStage(SLOW_AFTER_MS)), SLOW_AFTER_MS);
    const verySlow = window.setTimeout(() => setStage(loadingStage(VERY_SLOW_AFTER_MS)), VERY_SLOW_AFTER_MS);
    return () => {
      window.clearTimeout(slow);
      window.clearTimeout(verySlow);
    };
  }, []);

  const Icon = STAGE_ICON[stage];
  return (
    <div className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-ink/20 p-4 backdrop-blur-[2px]">
      <div role="status" data-testid="loading-hint" data-stage={stage} className="dtic-loader-card pointer-events-auto w-full max-w-md">
        <div className="relative flex flex-col items-center gap-5 overflow-hidden rounded-[14.5px] bg-surface px-6 pt-9 pb-10 text-center sm:px-8">
          <span className="dtic-orbit dtic-orbit--lg" aria-hidden="true">
            <span className="dtic-orbit__pulse" />
            <span className="dtic-orbit__arc" />
            <Icon className="dtic-orbit__icon size-8 text-accent" />
          </span>
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight text-ink">
              {label}
              <span className="dtic-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{LOADING_COPY[stage]}</p>
            {stage === "very_slow" && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
              >
                <RotateCw className="size-4" aria-hidden="true" /> Muat ulang halaman
              </button>
            )}
          </div>
          <div className="w-full" aria-hidden="true">
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#e5e7eb]" data-testid="loading-bar">
              <div className="dtic-fill relative h-full rounded-full bg-[linear-gradient(90deg,#0f766e,#10b981)]">
                <span className="dtic-comet" />
              </div>
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-ink-3"><span>Memuat</span><span>Selesai</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
