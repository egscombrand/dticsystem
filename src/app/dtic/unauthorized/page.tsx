import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export const metadata: Metadata = { title: "Akses ditolak" };

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-bad-soft">
          <ShieldAlert className="size-5 text-bad" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-navy">Anda tidak memiliki akses</h1>
        <p className="mt-2 text-sm text-ink-3">Akun Anda tidak diizinkan membuka halaman ini. Hubungi Super Admin bila menurut Anda ini keliru.</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href="/dtic/dashboard" className="inline-flex h-10 items-center justify-center rounded-lg bg-navy px-4 text-sm font-medium text-white hover:bg-[#1c3558]">Ke dashboard</Link>
        </div>
      </div>
    </div>
  );
}
