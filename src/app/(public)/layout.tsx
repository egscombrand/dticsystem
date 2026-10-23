import { MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { ConnectBrand } from "@/components/layout/connect-brand";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
          <Link href="/" aria-label="DTIC Connect — beranda" className="rounded-md">
            <ConnectBrand />
          </Link>
          <nav aria-label="Navigasi utama" className="flex min-w-0 items-center gap-px text-[12px] font-medium sm:gap-1 sm:text-[13px]">
            <Link href="/" className="shrink-0 rounded-lg px-1 py-2 text-navy hover:bg-teal/10 hover:text-teal sm:px-3">
              <span className="sm:hidden">Ajukan</span>
              <span className="hidden sm:inline">Ajukan Request</span>
            </Link>
            <Link href="/riwayat" className="shrink-0 rounded-lg px-1 py-2 text-navy hover:bg-teal/10 hover:text-teal sm:px-3">
              <span className="sm:hidden">Riwayat</span>
              <span className="hidden sm:inline">Riwayat Request</span>
            </Link>
            <Link href="/bantuan" className="flex shrink-0 items-center gap-1.5 rounded-lg px-1 py-2 text-navy hover:bg-teal/10 hover:text-teal sm:px-3">
              <MessageCircleQuestion className="hidden size-4 sm:inline" aria-hidden="true" />
              <span className="sm:hidden">Bantuan</span>
              <span className="hidden sm:inline">Bantuan &amp; Masukan</span>
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
