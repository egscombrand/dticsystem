"use client";

import { BookOpen, ClipboardPlus, History, MessageCircleQuestion, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { ConnectBrand } from "@/components/layout/connect-brand";
import { TutorialProvider } from "@/components/tutorial/tutorial-context";
import { ProductTour } from "@/components/tutorial/product-tour";
import { OnboardingPrompt } from "@/components/tutorial/onboarding-prompt";

const NAV_ITEMS: { href: string; tour?: string; icon: LucideIcon; short: string; full: string; match: (pathname: string) => boolean }[] = [
  { href: "/", tour: "nav-ajukan", icon: ClipboardPlus, short: "Ajukan", full: "Ajukan Request", match: (p) => p === "/" },
  { href: "/riwayat", tour: "nav-riwayat", icon: History, short: "Riwayat", full: "Riwayat Request", match: (p) => p === "/riwayat" || p.startsWith("/riwayat/") },
  { href: "/bantuan", tour: "nav-bantuan", icon: MessageCircleQuestion, short: "Bantuan", full: "Bantuan & Masukan", match: (p) => p === "/bantuan" || p.startsWith("/bantuan/") },
  { href: "/panduan", icon: BookOpen, short: "Panduan", full: "Panduan Penggunaan", match: (p) => p === "/panduan" || p.startsWith("/panduan/") },
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <TutorialProvider>
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
            <Link href="/" aria-label="DTIC Connect — beranda" className="rounded-md">
              <ConnectBrand />
            </Link>
            <nav aria-label="Navigasi utama" className="flex min-w-0 items-center gap-px overflow-x-auto text-[12px] font-medium [scrollbar-width:none] sm:gap-1 sm:text-[13px] [&::-webkit-scrollbar]:hidden">
              {NAV_ITEMS.map(({ href, tour, icon: Icon, short, full, match }) => {
                const active = match(pathname ?? "");
                return (
                  <Link
                    key={href}
                    data-tour={tour}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-lg px-1 py-2 hover:bg-teal/10 hover:text-teal focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none sm:px-3",
                      active ? "bg-teal/10 text-teal" : "text-navy",
                    )}
                  >
                    <Icon className="size-[18px] shrink-0 sm:size-5" aria-hidden="true" />
                    <span className="sm:hidden">{short}</span>
                    <span className="hidden sm:inline">{full}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </div>
      <ProductTour />
      <OnboardingPrompt />
    </TutorialProvider>
  );
}
