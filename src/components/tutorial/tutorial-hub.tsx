"use client";

import { useState } from "react";
import { PlayCircle, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TutorialCard } from "@/components/tutorial/tutorial-card";
import { useTutorial } from "@/components/tutorial/tutorial-context";
import type { Tutorial } from "@/lib/tutorials";

const control = "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

/**
 * Pusat panduan: tombol pengenalan (bila ada tutorial dengan id `introId`), pencarian tanpa reload
 * (filter judul & deskripsi), dan kartu panduan per fitur. Kartu, tutorial, dan status progres dipakai
 * ulang dari infrastruktur yang ada (TutorialCard, useTutorial) — tidak ada mesin tutorial kedua di sini.
 */
export function TutorialHub({ tutorials, introId }: { tutorials: Tutorial[]; introId?: string }) {
  const { startTutorial } = useTutorial();
  const [q, setQ] = useState("");
  const intro = introId ? tutorials.find((t) => t.id === introId) : undefined;
  const query = q.trim().toLowerCase();
  const filtered = query ? tutorials.filter((t) => t.title.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)) : tutorials;

  return (
    <>
      {intro && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 bg-accent-soft p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
              <Sparkles className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">{intro.title}</p>
              <p className="mt-1 max-w-md text-[13px] leading-relaxed text-ink-2">{intro.description}</p>
            </div>
          </div>
          <Button onClick={() => startTutorial(intro.id)} icon={<PlayCircle className="size-4" aria-hidden="true" />}>
            Mulai Panduan Pengenalan
          </Button>
        </Card>
      )}

      <div className="relative mb-5 max-w-md">
        <label htmlFor="tutorial-search" className="sr-only">
          Cari panduan fitur
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
        <input
          id="tutorial-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari panduan fitur..."
          className={`${control} pl-9 pr-9`}
          maxLength={60}
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Hapus pencarian"
            className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-ink-3 hover:bg-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center text-ink-3">
          <Search className="size-7" aria-hidden="true" />
          <p className="text-sm font-medium text-ink">Tidak ada panduan yang cocok</p>
          <p className="text-[13px]">Coba kata kunci lain, misalnya &quot;QC&quot; atau &quot;PIC&quot;.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <TutorialCard key={t.id} tutorial={t} />
          ))}
        </div>
      )}
    </>
  );
}
