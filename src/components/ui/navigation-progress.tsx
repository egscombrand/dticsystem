"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Batas pengaman: bar tidak pernah menggantung lebih lama dari ini bila navigasi gagal/dibatalkan. */
const GUARD_MS = 20_000;

/**
 * Bar tipis di atas layar sebagai umpan balik INSTAN saat pengguna menekan tautan ke halaman lain — sebelum
 * halaman tujuan sempat menampilkan apa pun. Mulai saat tautan internal (path berbeda) diklik; selesai saat
 * path benar-benar berubah. Perubahan hanya pada query (filter) diabaikan: itu punya indikator sendiri.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState<number | null>(null); // null = tersembunyi
  const finishRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = false;
    let tick: number | undefined;
    let guard: number | undefined;
    let hide: number | undefined;

    const stopTimers = () => {
      window.clearInterval(tick);
      window.clearTimeout(guard);
    };
    const finish = () => {
      if (!active) return;
      active = false;
      stopTimers();
      setProgress(100);
      hide = window.setTimeout(() => setProgress(null), 240);
    };
    const start = () => {
      if (active) return;
      active = true;
      window.clearTimeout(hide);
      setProgress(8);
      // Mendekati 90% secara melambat — tidak pernah "penuh" sebelum halaman benar-benar tiba.
      tick = window.setInterval(() => setProgress((p) => (p === null ? p : p + (90 - p) * 0.08)), 200);
      guard = window.setTimeout(finish, GUARD_MS);
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      start();
    };

    finishRef.current = finish;
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      finishRef.current = null;
      stopTimers();
      window.clearTimeout(hide);
    };
  }, []);

  // Path berubah = halaman tujuan sudah tiba.
  useEffect(() => {
    finishRef.current?.();
  }, [pathname]);

  if (progress === null) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[110] h-[4px]" role="presentation" aria-hidden="true" data-testid="nav-progress">
      <div
        className="relative h-full bg-[linear-gradient(90deg,#0f766e,#10b981)] shadow-[0_0_10px_rgba(16,185,129,0.7)] transition-[width] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `${progress}%` }}
      >
        <span className="dtic-comet" />
      </div>
    </div>
  );
}
