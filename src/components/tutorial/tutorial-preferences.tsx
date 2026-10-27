"use client";

import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { isAutoWelcomeEnabled, setAutoWelcomeEnabled } from "@/lib/client/tutorial-progress";
import { useTutorial } from "@/components/tutorial/tutorial-context";

/**
 * Preferensi sambutan otomatis — terpisah dari status penyelesaian tutorial (lihat tutorial-progress.ts).
 * Menonaktifkan preferensi ini TIDAK menyembunyikan menu Panduan Penggunaan; pengguna tetap bisa membuka
 * dan menjalankan tutorial kapan saja secara manual lewat kartu-kartu di halaman ini.
 */
export function TutorialPreferences() {
  const { namespace } = useTutorial();
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const sync = () => setEnabled(isAutoWelcomeEnabled(namespace));
    sync();
  }, [namespace]);

  function toggle(next: boolean) {
    setAutoWelcomeEnabled(next, namespace);
    setEnabled(next);
  }

  return (
    <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-subtle text-ink-2">
          <Settings2 className="size-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-medium text-ink">Preferensi Panduan</p>
          <p className="text-xs text-ink-3">Atur apakah sambutan ditampilkan otomatis saat membuka beranda pertama kali.</p>
        </div>
      </div>
      <label htmlFor="auto-welcome-toggle" className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
        Tampilkan sambutan otomatis
        <input id="auto-welcome-toggle" type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} className="size-4 accent-accent" />
      </label>
    </Card>
  );
}
