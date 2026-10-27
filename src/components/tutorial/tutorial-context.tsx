"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getTutorial, type Tutorial } from "@/lib/tutorials";
import { setTutorialProgress } from "@/lib/client/tutorial-progress";

/** Dipertahankan di sessionStorage (bukan cuma state React) agar tour yang berpindah halaman
 *  (lihat Tutorial.steps[].navigateTo) tetap hidup setelah navigasi, tapi tidak menumpuk selamanya
 *  seperti localStorage bila pengguna menutup tab. */
const ACTIVE_KEY = "dtic-tutorial-active-v1";

type ActiveTour = { tutorialId: string; stepIndex: number };

type TutorialContextValue = {
  active: Tutorial | null;
  stepIndex: number;
  /** Namespace penyimpanan progres/preferensi — kosong untuk area publik (per-browser), id akun untuk
   *  area internal (lihat tutorial-progress.ts). Dipakai komponen lain yang membaca progres langsung
   *  (TutorialCard, TutorialPreferences, OnboardingPrompt). */
  namespace: string;
  startTutorial: (id: string, fromStep?: number) => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  close: () => void;
};

const TutorialContext = createContext<TutorialContextValue | null>(null);

function activeKeyFor(namespace: string): string {
  return namespace ? `${ACTIVE_KEY}:${namespace}` : ACTIVE_KEY;
}

function readActive(namespace: string): ActiveTour | null {
  try {
    const raw = sessionStorage.getItem(activeKeyFor(namespace));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.tutorialId === "string" && typeof parsed.stepIndex === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function writeActive(namespace: string, v: ActiveTour | null): void {
  try {
    if (v) sessionStorage.setItem(activeKeyFor(namespace), JSON.stringify(v));
    else sessionStorage.removeItem(activeKeyFor(namespace));
  } catch {
    // sessionStorage tidak tersedia — tour tetap berjalan, hanya tidak bertahan lintas navigasi
  }
}

/** Mesin panduan interaktif — dipasang SEKALI per layout (publik TANPA namespace; internal DENGAN
 *  namespace = id akun, lihat AppFrame di sidebar.tsx, supaya progres tidak bercampur antar-akun). */
export function TutorialProvider({ children, namespace = "" }: { children: ReactNode; namespace?: string }) {
  const router = useRouter();
  const [state, setState] = useState<ActiveTour | null>(null);

  useEffect(() => {
    const sync = () => setState(readActive(namespace));
    sync();
  }, [namespace]);

  const active = useMemo(() => (state ? getTutorial(state.tutorialId) ?? null : null), [state]);
  const stepIndex = state?.stepIndex ?? 0;

  const persist = useCallback(
    (next: ActiveTour | null) => {
      setState(next);
      writeActive(namespace, next);
    },
    [namespace],
  );

  const startTutorial = useCallback(
    (id: string, fromStep = 0) => {
      const t = getTutorial(id);
      if (!t) return;
      const startAt = Math.min(Math.max(0, fromStep), t.steps.length - 1);
      persist({ tutorialId: id, stepIndex: startAt });
      setTutorialProgress(id, "in_progress", startAt, namespace);
      // Halaman pola (diakhiri "/*", id dinamis — lihat product-tour.tsx pageMatches) tidak valid untuk
      // dinavigasi langsung; pakai startPage tutorial sebagai gantinya.
      const targetPage = t.steps[startAt]?.target?.page;
      const page = targetPage && !targetPage.endsWith("/*") ? targetPage : t.startPage;
      if (page) router.push(page);
    },
    [persist, router, namespace],
  );

  const goTo = useCallback(
    (i: number) => {
      if (!state || !active) return;
      if (i < 0) return;
      if (i >= active.steps.length) {
        setTutorialProgress(active.id, "completed", active.steps.length - 1, namespace);
        persist(null);
        return;
      }
      const nextStep = active.steps[i];
      persist({ tutorialId: state.tutorialId, stepIndex: i });
      setTutorialProgress(active.id, "in_progress", i, namespace);
      if (nextStep.navigateTo) router.push(nextStep.navigateTo);
    },
    [state, active, persist, router, namespace],
  );

  const next = useCallback(() => goTo(stepIndex + 1), [goTo, stepIndex]);
  const back = useCallback(() => goTo(stepIndex - 1), [goTo, stepIndex]);

  const skip = useCallback(() => {
    if (active) setTutorialProgress(active.id, "in_progress", stepIndex, namespace);
    persist(null);
  }, [active, stepIndex, persist, namespace]);

  const close = useCallback(() => {
    if (active) setTutorialProgress(active.id, "in_progress", stepIndex, namespace);
    persist(null);
  }, [active, stepIndex, persist, namespace]);

  const value = useMemo(
    () => ({ active, stepIndex, namespace, startTutorial, next, back, skip, close }),
    [active, stepIndex, namespace, startTutorial, next, back, skip, close],
  );

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error("useTutorial harus dipakai di dalam TutorialProvider");
  return ctx;
}
