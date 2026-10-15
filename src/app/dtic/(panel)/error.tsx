"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function InternalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-surface p-8 text-center shadow-card">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-bad-soft">
        <AlertCircle className="size-5 text-bad" aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-base font-semibold text-ink">Data gagal dimuat</h1>
      <p className="mt-1 text-sm text-ink-3">
        Server tidak dapat mengambil data dari database. Data tidak ditampilkan agar tidak menyesatkan. Periksa koneksi atau konfigurasi database (detail ada di log server), lalu coba lagi.
      </p>
      {/* Pesan asli hanya di development; di production Next.js menyembunyikannya (lihat log server). */}
      {process.env.NODE_ENV === "development" && error.message && (
        <p className="mt-3 rounded-md bg-subtle px-3 py-2 text-left font-mono text-xs break-words text-ink-2">{error.message}</p>
      )}
      {error.digest && <p className="mt-3 font-mono text-xs text-ink-3">Kode: {error.digest}</p>}
      <Button className="mt-5" variant="secondary" onClick={() => retry()} icon={<RotateCcw className="size-4" />}>
        Coba lagi
      </Button>
    </div>
  );
}
