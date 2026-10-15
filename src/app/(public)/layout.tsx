import Link from "next/link";
import { ConnectBrand } from "@/components/layout/connect-brand";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="DTIC Connect — beranda" className="rounded-md">
            <ConnectBrand />
          </Link>
          <nav aria-label="Navigasi utama" className="flex items-center gap-1 text-[13px] font-medium">
            <Link href="/" className="rounded-lg px-3 py-2 text-navy hover:bg-teal/10 hover:text-teal">Ajukan Request</Link>
            <Link href="/riwayat" className="rounded-lg px-3 py-2 text-navy hover:bg-teal/10 hover:text-teal">Riwayat Request</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
