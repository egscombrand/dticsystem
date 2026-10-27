"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { hasSeenWelcome, isAutoWelcomeEnabled, markWelcomeSeen } from "@/lib/client/tutorial-progress";
import { useTutorial } from "@/components/tutorial/tutorial-context";

export type OnboardingPromptProps = {
  /** Halaman tempat sambutan otomatis ditampilkan. Default: beranda publik ("/"). */
  welcomePath?: string;
  /** Tutorial yang dibuka saat tombol "Mulai Panduan" ditekan. */
  tutorialId?: string;
  title?: string;
  description?: string;
  intro?: string;
  dismissLabel?: string;
};

/**
 * Sambutan otomatis — hanya tampil sekali (per preferensi aktif) saat pengguna membuka halaman awalnya,
 * bukan setiap kunjungan/perpindahan halaman (lihat hasSeenWelcome). Tidak tampil jika preferensi
 * dinonaktifkan (lihat isAutoWelcomeEnabled, diatur lewat kartu Preferensi Panduan di halaman Panduan) atau
 * tour lain sedang berjalan, supaya tidak ada dua dialog panduan sekaligus. Dipasang sekali per layout
 * (publik: default pemohon; internal: props Manager, lihat AppFrame di sidebar.tsx) — namespace progres
 * diambil dari TutorialProvider (lihat useTutorial), bukan prop di sini, supaya tidak bisa salah pasang.
 */
export function OnboardingPrompt({
  welcomePath = "/",
  tutorialId = "mengenal-dashboard",
  title = "Selamat Datang di DTIC Nexus",
  description = "Pusat pengelolaan permintaan pekerjaan yang terintegrasi.",
  intro = "DTIC Nexus membantu Anda mengajukan permintaan pekerjaan, memantau progres, dan meninjau hasil pekerjaan melalui satu platform.",
  dismissLabel = "Masuk ke Dashboard",
}: OnboardingPromptProps) {
  const { active, startTutorial, namespace } = useTutorial();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (pathname !== welcomePath || active || !isAutoWelcomeEnabled(namespace) || hasSeenWelcome(namespace)) return;
    const timer = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(timer);
  }, [pathname, welcomePath, active, namespace]);

  function dismiss() {
    markWelcomeSeen(namespace);
    setOpen(false);
  }

  return (
    <Modal open={open} onClose={dismiss} title={title} description={description}>
      <p className="text-sm leading-relaxed text-ink-2">{intro}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={dismiss}>
          {dismissLabel}
        </Button>
        <Button
          onClick={() => {
            markWelcomeSeen(namespace);
            setOpen(false);
            startTutorial(tutorialId);
          }}
        >
          Mulai Panduan
        </Button>
      </div>
    </Modal>
  );
}
