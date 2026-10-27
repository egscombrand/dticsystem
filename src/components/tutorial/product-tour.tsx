"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useTutorial } from "@/components/tutorial/tutorial-context";

type Rect = { top: number; left: number; width: number; height: number };
type Arrow = "top" | "bottom" | "left" | "right" | null;
type Placement = { top: number; left: number; arrow: Arrow; arrowOffset: number };

const PANEL_W = 340;
const PANEL_W_MOBILE_MARGIN = 32; // 16px tiap sisi
const MARGIN = 18;
const DEFAULT_PANEL_H = 200; // estimasi sebelum panel sungguhan terukur (lihat useLayoutEffect panelH)
const PANEL_MAX_H_RATIO = 0.62; // panel tidak pernah menutupi lebih dari ~62% tinggi layar — sisanya tetap terlihat & bisa digulir

/** `page` cocok persis, KECUALI diakhiri "/*" (mis. "/dtic/orders/*") — dipakai untuk langkah yang
 *  menjelaskan elemen pada halaman detail dengan id dinamis (order tertentu): tidak tahu id-nya di muka
 *  (lihat tutorials.ts manager-keputusan-qc), jadi sorotan hanya muncul OPORTUNISTIK bila pengguna
 *  sedang membuka halaman detail APA PUN yang cocok pola — bukan dipaksa navigasi ke satu id tertentu. */
function pageMatches(pattern: string, pathname: string): boolean {
  if (pattern.endsWith("/*")) return pathname.startsWith(pattern.slice(0, -1));
  return pattern === pathname;
}

function measure(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null; // display:none / hidden attribute → anggap tidak ada
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/**
 * Penempatan adaptif 4 arah (bawah → atas → kanan → kiri, dipilih berdasarkan ruang yang benar-benar
 * tersedia di viewport) — bukan satu posisi tetap untuk semua langkah. `arrow` menandai sisi panel yang
 * menunjuk ke target, dipakai untuk menggambar indikator arah.
 */
function computePlacement(rect: Rect, panelW: number, panelH: number): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.min(Math.max(MARGIN, x), Math.max(MARGIN, vw - panelW - MARGIN));
  const clampY = (y: number) => Math.min(Math.max(MARGIN, y), Math.max(MARGIN, vh - panelH - MARGIN));
  const spaceBelow = vh - (rect.top + rect.height);
  const spaceAbove = rect.top;
  const spaceRight = vw - (rect.left + rect.width);
  const spaceLeft = rect.left;
  const centerX = rect.left + rect.width / 2 - panelW / 2;
  const centerY = rect.top + rect.height / 2 - panelH / 2;

  let top: number;
  let left: number;
  let arrow: Arrow;
  if (spaceBelow >= panelH + MARGIN) {
    top = rect.top + rect.height + MARGIN;
    left = clampX(centerX);
    arrow = "top";
  } else if (spaceAbove >= panelH + MARGIN) {
    top = rect.top - MARGIN - panelH;
    left = clampX(centerX);
    arrow = "bottom";
  } else if (spaceRight >= panelW + MARGIN) {
    top = clampY(centerY);
    left = rect.left + rect.width + MARGIN;
    arrow = "left";
  } else if (spaceLeft >= panelW + MARGIN) {
    top = clampY(centerY);
    left = rect.left - MARGIN - panelW;
    arrow = "right";
  } else {
    // Tidak ada sisi dengan ruang cukup (target memenuhi hampir seluruh layar) — tetap tampilkan di bawah,
    // dijepit ke dalam viewport, tanpa panah (lebih baik tumpang tindih sedikit daripada keluar layar).
    top = clampY(rect.top + rect.height + MARGIN);
    left = clampX(centerX);
    arrow = null;
  }
  const arrowOffset = Math.min(Math.max(16, rect.left + rect.width / 2 - left - 6), panelW - 28);
  return { top, left, arrow, arrowOffset };
}

/**
 * Tampilan panduan interaktif — satu instans dipasang di layout publik lewat TutorialProvider.
 * Jika elemen target tidak ditemukan di halaman saat ini (langkah ini untuk halaman lain, atau elemen
 * belum terlihat karena pengguna belum mengklik langkah form yang sesuai), tampilkan panel penjelasan
 * saja tanpa sorotan — TIDAK PERNAH macet atau menampilkan error (lihat measure()).
 */
export function ProductTour() {
  const { active, stepIndex, next, back, skip, close } = useTutorial();
  const pathname = usePathname();
  const router = useRouter();
  const [rect, setRect] = useState<Rect | null>(null);
  const [panelH, setPanelH] = useState(DEFAULT_PANEL_H);
  const [showCompletion, setShowCompletion] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const step = active?.steps[stepIndex] ?? null;

  useEffect(() => {
    if (!step) return;
    const onTargetPage = !!(step.target && pageMatches(step.target.page, pathname));
    const sync = () => setRect(onTargetPage ? measure(step.target!.selector) : null);
    sync();
    if (!onTargetPage) return;
    const id = window.setInterval(sync, 300); // form yang sama bisa berubah tanpa navigasi (step wizard)
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [step, pathname]);

  useEffect(() => {
    if (!step) return;
    panelRef.current?.focus();
    if (rect && step.target) {
      document.querySelector(step.target.selector)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, active?.id]);

  // Ukur tinggi panel SUNGGUHAN (konten tiap langkah berbeda panjang) supaya perhitungan ruang tersedia
  // akurat, bukan tebakan tetap — dipakai computePlacement pada render berikutnya. Dependensi memakai
  // `rect !== null` (boolean stabil), BUKAN objek `rect` itu sendiri — measure() membuat objek literal
  // baru setiap polling (tiap 300ms di efek di atas), yang kalau dipakai langsung sebagai dependensi
  // akan membuat efek ini (dan setPanelH-nya) berjalan ulang terus-menerus walau tinggi panel tidak
  // benar-benar berubah. Panjang & bentuk array dependensi tetap SAMA di setiap render.
  const hasRect = rect !== null;
  useLayoutEffect(() => {
    const h = panelRef.current?.offsetHeight;
    if (h && Math.abs(h - panelH) > 4) setPanelH(h);
  }, [panelH, step, stepIndex, hasRect]);

  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close]);

  if (!active || !step) return null;

  const total = active.steps.length;
  const isLast = stepIndex === total - 1;
  const percent = Math.round(((stepIndex + 1) / total) * 100);
  const panelW = Math.min(PANEL_W, window.innerWidth - PANEL_W_MOBILE_MARGIN);
  const panelMaxH = Math.round(window.innerHeight * PANEL_MAX_H_RATIO);
  const effectiveH = Math.min(panelH, panelMaxH);

  const placement: Placement = rect
    ? computePlacement(rect, panelW, effectiveH)
    : { top: window.innerHeight - effectiveH - 24, left: (window.innerWidth - panelW) / 2, arrow: null, arrowOffset: 0 };

  const ARROW_STYLE: Record<Exclude<Arrow, null>, React.CSSProperties> = {
    top: { top: -6, left: placement.arrowOffset, borderTop: "none", borderLeft: "none" },
    bottom: { bottom: -6, left: placement.arrowOffset, borderBottom: "none", borderRight: "none" },
    left: { left: -6, top: Math.min(Math.max(16, panelH / 2 - 6), panelH - 28), borderLeft: "none", borderBottom: "none" },
    right: { right: -6, top: Math.min(Math.max(16, panelH / 2 - 6), panelH - 28), borderRight: "none", borderTop: "none" },
  };

  function finish() {
    setShowCompletion(true);
  }

  /**
   * Langkah "klik baris ini" (lihat TutorialStep.clickTargetOnAdvance): pengguna sering tidak sadar
   * overlay tour bisa ditembus klik (pointer-events-none di wadah luar) sehingga tampak macet saat
   * langkah berikutnya butuh halaman lain. Menekan "Berikutnya" di sini mengklik tautan SUNGGUHAN di
   * dalam elemen target (bukan target itu sendiri, yang biasanya <tr>/<li> tanpa handler) sebelum
   * pindah langkah — aman bila elemen/tautan tidak ada (akun tanpa data), klik dilewati tanpa error.
   */
  function advance() {
    if (isLast) {
      finish();
      return;
    }
    if (step?.clickTargetOnAdvance && step.target) {
      const el = document.querySelector<HTMLElement>(step.target.selector);
      const link = el?.querySelector<HTMLAnchorElement>("a") ?? (el instanceof HTMLAnchorElement ? el : null);
      link?.click();
    }
    next();
  }

  return (
    <>
    {/* pointer-events-none di wadah luar: tour adalah PANDUAN VISUAL, bukan kunci interaksi — elemen asli
        di baliknya (termasuk mode simulasi formulir pengajuan) harus tetap bisa diklik langsung oleh
        pengguna. Hanya panel penjelasan (pointer-events-auto di bawah) yang sungguh menangkap klik. */}
    <div className="pointer-events-none fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={`Panduan: ${active.title}`}>
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-xl ring-2 ring-accent transition-all duration-200"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 9999px rgb(15 23 42 / 0.5)" }}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 bg-[rgb(15_23_42_/_0.4)]" />
      )}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="pointer-events-auto fixed z-[101] flex flex-col gap-3 overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-pop transition-[top,left] duration-150 focus:outline-none"
        style={{ top: placement.top, left: placement.left, width: panelW, maxHeight: panelMaxH }}
      >
        {placement.arrow && (
          <span className="absolute size-3 rotate-45 border border-line bg-surface" style={ARROW_STYLE[placement.arrow]} aria-hidden="true" />
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <p className="text-xs font-medium text-ink-3">
              Langkah {stepIndex + 1} dari {total} · {percent}% selesai
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-subtle">
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <button type="button" onClick={close} aria-label="Tutup panduan" className="shrink-0 rounded-md p-1 text-ink-3 hover:bg-subtle hover:text-ink">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <h3 className="text-[15px] font-semibold text-ink">{step.title}</h3>
        <p className="text-[13px] leading-relaxed text-ink-2">{step.body}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={skip}>
            Lewati
          </Button>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button variant="secondary" size="sm" onClick={back} icon={<ArrowLeft className="size-3.5" aria-hidden="true" />}>
                Kembali
              </Button>
            )}
            <Button size="sm" onClick={advance} icon={!isLast ? <ArrowRight className="size-3.5" aria-hidden="true" /> : undefined}>
              {isLast ? (active.completion?.kind === "start_request" ? "Selesai dan Mulai Pengajuan" : "Selesai") : "Berikutnya"}
            </Button>
          </div>
        </div>
      </div>
    </div>
    <Modal open={showCompletion} onClose={() => { setShowCompletion(false); next(); }} title="Tutorial Selesai!" description={`Anda telah menyelesaikan panduan "${active.title}".`}>
      <div className="flex items-center gap-3 rounded-xl bg-ok-soft p-4">
        <CheckCircle2 className="size-8 shrink-0 text-ok" aria-hidden="true" />
        <p className="text-sm leading-relaxed text-ink-2">
          {active.completion?.kind === "start_request"
            ? "Formulir di bawah ini sekarang siap diisi dengan data sungguhan — bukan lagi contoh."
            : "Anda dapat membuka panduan ini kapan saja lagi lewat menu Panduan Penggunaan."}
        </p>
      </div>
      {active.completion?.kind === "start_request" ? (
        <div className="mt-5 flex justify-end">
          <Button
            onClick={() => {
              setShowCompletion(false);
              next(); // menutup tour; submission-form mengembalikan wizard ke langkah 1 dalam mode normal (lihat efek sinkronisasi di sana)
            }}
          >
            Selesai dan Mulai Pengajuan
          </Button>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setShowCompletion(false);
              next();
              router.push(active.completion?.kind === "generic" ? active.completion.hubPath ?? "/panduan" : "/panduan");
            }}
          >
            Kembali ke Awal
          </Button>
          <Button
            onClick={() => {
              setShowCompletion(false);
              next();
              const fallback = { label: "Mulai Pengajuan", href: "/" };
              const secondary = active.completion?.kind === "generic" ? active.completion.secondaryAction ?? fallback : fallback;
              router.push(secondary.href);
            }}
          >
            {active.completion?.kind === "generic" ? active.completion.secondaryAction?.label ?? "Mulai Pengajuan" : "Mulai Pengajuan"}
          </Button>
        </div>
      )}
    </Modal>
    </>
  );
}
