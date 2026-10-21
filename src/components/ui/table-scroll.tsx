import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Pembungkus standar untuk setiap <table> di DTIC Nexus (dipakai konsisten di semua halaman — daftar
 * order, data master, pengguna, audit log, Google Drive, dst.). Tabel selalu mengisi lebar container
 * (w-full pada elemen <table> itu sendiri) tapi tidak pernah diremas di bawah `minWidthPx`; bila container
 * lebih sempit dari itu, HANYA tabel ini yang mendapat scroll horizontal (overflow-x-auto) — tidak pernah
 * seluruh halaman.
 *
 * Tidak ada ResizeObserver atau state lebar yang diukur JS: lebar container induk sudah murni mengikuti
 * CSS (padding sidebar di AppFrame berubah lewat kelas Tailwind + transition, bukan lewat ukuran yang
 * diukur JavaScript — lihat src/components/layout/sidebar.tsx), jadi tabel otomatis mengikuti setiap kali
 * sidebar dibuka/ditutup tanpa remount maupun re-render komponen tabel sama sekali.
 */
export function TableScroll({ minWidthPx, className, children }: { minWidthPx: number; className?: string; children: ReactNode }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <div style={{ minWidth: `${minWidthPx}px` }}>{children}</div>
    </div>
  );
}
