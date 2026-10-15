"use client";

import { Send } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";

/** Durasi animasi keluar (ms). Harus sama dengan transisi .dtic-dialog di globals.css. */
const CLOSE_MS = 160;

/**
 * Konfirmasi sebelum pengajuan dikirim. Memakai <dialog> native: fokus terkunci, Esc, dan keyboard bawaan.
 * Tidak mengirim apa pun sendiri; tombol "Ya" hanya memanggil onConfirm. Selama `busy`, dialog tidak bisa ditutup.
 */
export function SubmitConfirmDialog({ open, busy, onCancel, onConfirm }: { open: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      if (!d.open) d.showModal();
      d.removeAttribute("data-state");
      return;
    }
    if (!d.open) return;
    d.setAttribute("data-state", "closing");
    const timer = window.setTimeout(() => d.close(), CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descId}
      aria-busy={busy}
      className="dtic-dialog m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line bg-surface p-0 text-ink shadow-pop"
      onCancel={(e) => {
        // Esc: tutup tanpa mengirim, kecuali sedang mengirim.
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onCancel();
      }}
    >
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
            <Send className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">Konfirmasi Pengajuan</h2>
            <p id={descId} className="mt-1.5 text-sm leading-relaxed text-ink-2">
              Apakah Anda yakin ingin mengirim pengajuan ini? Pastikan seluruh informasi yang Anda masukkan sudah benar.
            </p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy} autoFocus>
            Belum, Kembali Edit
          </Button>
          <Button onClick={onConfirm} loading={busy} disabled={busy}>
            {busy ? "Mengirim…" : "Ya, Kirim Pengajuan"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
