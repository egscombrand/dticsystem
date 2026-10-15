import { SearchX } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-surface ring-1 ring-line">
          <SearchX className="size-5 text-ink-3" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-base font-semibold text-ink">Halaman tidak ditemukan</h1>
        <p className="mt-1 text-sm text-ink-3">Alamat yang Anda buka tidak tersedia.</p>
        <Link href="/" className="mt-5 inline-block text-sm font-medium text-accent hover:text-accent-hover">
          Ke form pengajuan order
        </Link>
      </div>
    </div>
  );
}
