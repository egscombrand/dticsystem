"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Panel "Filter Lainnya" (PIC, Kategori, Deadline, Status QC) — dipisah dari kontrol utama (pencarian +
 * status) agar baris filter tidak panjang dan bercampur. Field di dalamnya adalah <select> terkendali milik
 * OrderFilters (navigasi real-time lewat router.push, lihat OrderFilters) — komponen ini hanya mengatur
 * TAMPIL/SEMBUNYI lewat CSS. Terbuka otomatis jika ada filter sekunder yang sedang aktif, supaya pengguna
 * tidak kebingungan filter apa yang berlaku.
 */
export function MoreFiltersToggle({ activeCount, children }: { activeCount: number; children: ReactNode }) {
  const [open, setOpen] = useState(activeCount > 0);
  return (
    <div className="sm:col-span-2 lg:col-span-12">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="more-filters-panel"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink-2 hover:bg-subtle"
      >
        <SlidersHorizontal className="size-3.5" aria-hidden="true" />
        Filter Lainnya
        {activeCount > 0 && (
          <span className="flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-white">{activeCount}</span>
        )}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div id="more-filters-panel" className="mt-3 grid gap-3 rounded-lg border border-line bg-subtle/60 p-3 sm:grid-cols-2 lg:grid-cols-12">
          {children}
        </div>
      )}
    </div>
  );
}
