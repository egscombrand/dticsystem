import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { tutorialsForRole } from "@/lib/tutorials";
import { TutorialCard } from "@/components/tutorial/tutorial-card";
import { TutorialPreferences } from "@/components/tutorial/tutorial-preferences";

export const metadata: Metadata = { title: "Panduan Penggunaan" };

/** Hanya tutorial role "pemohon" ditampilkan — lihat src/lib/tutorials.ts untuk alasan pembatasan ini. */
export default function PanduanPage() {
  const tutorials = tutorialsForRole("pemohon");

  return (
    <>
      <div className="mb-8">
        <div className="flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <BookOpen className="size-5" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-navy sm:text-[28px]">Panduan Penggunaan DTIC Nexus</h1>
        </div>
        <p className="mt-3 max-w-2xl text-sm text-ink-3">Pelajari cara menggunakan DTIC Nexus melalui panduan interaktif langkah demi langkah.</p>
      </div>
      <TutorialPreferences />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tutorials.map((t) => (
          <TutorialCard key={t.id} tutorial={t} />
        ))}
      </div>
    </>
  );
}
