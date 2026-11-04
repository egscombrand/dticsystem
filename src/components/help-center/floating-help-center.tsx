"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, ArrowLeft, BookOpen, Lightbulb, Ticket, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { FeedbackTrackingClient } from "@/components/feedback/feedback-tracking-client";
import Image from "next/image";
import { useTutorial } from "@/components/tutorial/tutorial-context";
import { FEEDBACK_KIND_LABEL, FEEDBACK_STATUS_LABEL, FEEDBACK_STATUS_TONE, type FeedbackKind, type FeedbackStatus } from "@/lib/validation/feedback";
import type { Role } from "@/lib/auth/permissions";

type View = "home" | "kendala" | "masukan" | "tiket";

/** Tutorial Panduan Penggunaan yang nyata per role — tidak ada untuk super_admin (lihat laporan akhir). */
const PANDUAN_HREF: Partial<Record<Role, string>> = { manager: "/dtic/panduan", staff: "/dtic/panduan" };

type MyTicket = { id: string; ticketNumber: string; kind: FeedbackKind; title: string; status: FeedbackStatus; createdAt: string };

/**
 * Floating Help Center — tombol avatar mengambang + panel 4 layanan (Panduan, Laporkan Kendala, Kirim
 * Masukan, Tiket Saya). Dipasang SEKALI per layout (lihat public layout & AppFrame) supaya tersedia di
 * seluruh halaman tanpa membuat mesin tiket/tutorial kedua — seluruhnya memakai kembali FeedbackForm,
 * FeedbackTrackingClient, dan tutorial yang sudah ada.
 *
 * `knownRole`: AppFrame (area internal) sudah tahu role dari sesi server, dikirim langsung — tidak perlu
 * fetch. Area publik tidak tahu (bisa tamu ATAU staf yang sedang membuka "/", lihat menu "Form Pengajuan")
 * — role baru diambil (sekali, lewat /api/public/me) saat panel dibuka, bukan di setiap pemuatan halaman.
 * Dipasang di DALAM TutorialProvider pada kedua layout (sama seperti ProductTour/OnboardingPrompt) —
 * `useTutorial()` dipakai langsung di sini (bukan prop) supaya panel otomatis tertutup/tersembunyi saat
 * panduan interaktif sedang berjalan, tanpa dua lapisan "panduan" tumpang tindih.
 */
export function FloatingHelpCenter({ knownRole }: { knownRole?: Role | null }) {
  const pathname = usePathname();
  const { active } = useTutorial();
  const tourActive = !!active;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("home");
  const [role, setRole] = useState<Role | null | undefined>(knownRole);
  const panelRef = useRef<HTMLDivElement>(null);

  // Panel tertutup otomatis saat panduan interaktif MULAI berjalan (hindari dua lapisan "panduan"
  // tumpang tindih) — pola resmi React "menyesuaikan state saat render" (lihat sidebar.tsx AppFrame,
  // drawer mobile memakai pola identik), BUKAN setState di dalam efek.
  const [wasTourActive, setWasTourActive] = useState(tourActive);
  if (tourActive !== wasTourActive) {
    setWasTourActive(tourActive);
    if (tourActive && open) setOpen(false);
  }

  useEffect(() => {
    if (knownRole !== undefined || role !== undefined || !open) return;
    let cancelled = false;
    fetch("/api/public/me", { headers: { "X-DTIC-Request": "1" } })
      .then((r) => r.json())
      .then((d: { role: Role | null }) => { if (!cancelled) setRole(d.role); })
      .catch(() => { if (!cancelled) setRole(null); });
    return () => { cancelled = true; };
  }, [open, knownRole, role]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Berpindah halaman menutup panel — menghindari panel "menggantung" di atas konten yang sudah berbeda.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  // Tombol TETAP terlihat saat panduan interaktif berjalan (panduan Pemohon menyorotnya langsung sebagai
  // elemen asli, data-tour="help-button") — hanya PANEL yang otomatis tertutup/tidak dibuka (lihat efek di
  // atas) supaya tidak ada dua lapisan "panduan" sekaligus.
  const resolvedRole = role === undefined ? knownRole ?? null : role;
  const panduanHref = resolvedRole ? (PANDUAN_HREF[resolvedRole] ?? null) : "/panduan";

  function close() {
    setOpen(false);
    setView("home");
  }

  return (
    <div className="fixed right-4 bottom-4 z-40 sm:right-6 sm:bottom-6">
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="Pusat Bantuan DTIC Nexus"
          className="form-rise mb-3 flex max-h-[min(32rem,calc(100vh-7rem))] w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
          style={{ animationDuration: "160ms" }}
        >
          <HelpPanelBody view={view} setView={setView} close={close} role={resolvedRole} panduanHref={panduanHref} pathname={pathname} />
        </div>
      )}
      <button
        type="button"
        onClick={() => { if (!tourActive) setOpen((v) => !v); }}
        data-tour="help-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={open ? "Tutup Pusat Bantuan" : "Butuh bantuan? Buka Pusat Bantuan"}
        className="group flex items-center gap-2.5 rounded-full bg-surface py-1.5 pr-4 pl-1.5 shadow-pop ring-1 ring-line transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-8px_rgb(15_118_110/0.35)] focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
      >
        {open ? (
          <span className="flex size-10 items-center justify-center rounded-full bg-subtle text-ink-2">
            <X className="size-5" aria-hidden="true" />
          </span>
        ) : (
          <span className="block size-10 shrink-0 overflow-hidden rounded-full ring-1 ring-line transition-transform duration-200 group-hover:scale-105">
            <Image src="/help-center/avatar.jpg" alt="" width={256} height={256} className="size-full object-cover" priority={false} />
          </span>
        )}
        <span className="hidden text-[13px] font-medium whitespace-nowrap text-ink sm:inline">{open ? "Tutup" : "Butuh Bantuan?"}</span>
      </button>
    </div>
  );
}

function HelpPanelBody({
  view,
  setView,
  close,
  role,
  panduanHref,
  pathname,
}: {
  view: View;
  setView: (v: View) => void;
  close: () => void;
  role: Role | null;
  panduanHref: string | null;
  pathname: string;
}) {
  const title = view === "home" ? "Pusat Bantuan DTIC Nexus" : view === "kendala" ? "Laporkan Kendala" : view === "masukan" ? "Kirim Masukan" : "Tiket Saya";
  return (
    <>
      <header className="flex items-center gap-2 border-b border-line bg-[linear-gradient(135deg,#0f766e,#10b981)] px-4 py-3 text-white">
        {view !== "home" && (
          <button type="button" onClick={() => setView("home")} aria-label="Kembali" className="rounded-md p-1 hover:bg-white/15">
            <ArrowLeft className="size-4" aria-hidden="true" />
          </button>
        )}
        <h2 className="flex-1 text-[14px] font-semibold">{title}</h2>
        <button type="button" onClick={close} aria-label="Tutup panel bantuan" className="rounded-md p-1 hover:bg-white/15">
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {view === "home" && (
          <>
            <p className="mb-4 text-[13px] text-ink-2">Halo! Ada yang bisa kami bantu hari ini?</p>
            <div className="flex flex-col gap-2">
              {panduanHref ? (
                <Link href={panduanHref} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left text-sm text-ink transition-colors hover:border-accent hover:bg-accent-soft/40">
                  <BookOpen className="size-4 shrink-0 text-accent" aria-hidden="true" />
                  <span>
                    <span className="block font-medium">Panduan Penggunaan</span>
                    <span className="block text-[12px] text-ink-3">Pelajari fitur lewat tutorial interaktif</span>
                  </span>
                </Link>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2.5 text-left text-sm text-ink-3">
                  <BookOpen className="size-4 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="block font-medium text-ink-2">Panduan Penggunaan</span>
                    <span className="block text-[12px]">Belum tersedia untuk akun Anda</span>
                  </span>
                </div>
              )}
              <ServiceButton icon={AlertTriangle} label="Laporkan Kendala" desc="Masalah atau error pada sistem" onClick={() => setView("kendala")} />
              <ServiceButton icon={Lightbulb} label="Kirim Masukan" desc="Ide, saran, atau permintaan fitur" onClick={() => setView("masukan")} />
              <ServiceButton icon={Ticket} label="Tiket Saya" desc={role ? "Lihat tiket yang pernah Anda buat" : "Lacak status laporan dengan nomor tiket"} onClick={() => setView("tiket")} />
            </div>
          </>
        )}
        {/* TIDAK berpindah view otomatis setelah terkirim — FeedbackForm menampilkan layar "Laporan terkirim"
            miliknya sendiri dahulu (sama seperti halaman /bantuan penuh); berpindah paksa di sini akan
            melepas FeedbackForm SEBELUM layar itu sempat dirender (state ticketNumber-nya hilang bersama
            unmount), membuat konfirmasi pengiriman tidak pernah terlihat pengguna. */}
        {view === "kendala" && <FeedbackForm compact defaultKind="bug" hasSession={!!role} initialOrderNumber="" idPrefix="help-kendala-" />}
        {view === "masukan" && <FeedbackForm compact defaultKind="suggestion" hasSession={!!role} initialOrderNumber="" idPrefix="help-masukan-" />}
        {view === "tiket" && (role ? <MyTicketsList /> : <FeedbackTrackingClient />)}
      </div>
      {(view === "kendala" || view === "masukan") && (
        <p className="border-t border-line px-4 py-2 text-[11px] text-ink-3">Halaman asal: {originLabel(pathname)}</p>
      )}
    </>
  );
}

function originLabel(pathname: string): string {
  if (pathname === "/") return "Beranda";
  if (pathname.startsWith("/riwayat")) return "Riwayat Request";
  if (pathname.startsWith("/dtic/dashboard")) return "Dashboard";
  if (pathname.startsWith("/dtic/orders")) return "Pengelolaan Pekerjaan";
  return pathname;
}

function ServiceButton({ icon: Icon, label, desc, onClick }: { icon: typeof AlertTriangle; label: string; desc: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left text-sm text-ink transition-colors hover:border-accent hover:bg-accent-soft/40">
      <Icon className="size-4 shrink-0 text-accent" aria-hidden="true" />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-[12px] text-ink-3">{desc}</span>
      </span>
    </button>
  );
}

function MyTicketsList() {
  const [state, setState] = useState<{ loading: boolean; tickets: MyTicket[]; error: string | null }>({ loading: true, tickets: [], error: null });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/internal/feedback/mine?pageSize=10", { headers: { "X-DTIC-Request": "1" } })
      .then((r) => r.json())
      .then((d: { tickets?: MyTicket[]; error?: string }) => {
        if (cancelled) return;
        if (d.tickets) setState({ loading: false, tickets: d.tickets, error: null });
        else setState({ loading: false, tickets: [], error: d.error ?? "Gagal memuat tiket." });
      })
      .catch(() => { if (!cancelled) setState({ loading: false, tickets: [], error: "Gagal memuat tiket." }); });
    return () => { cancelled = true; };
  }, []);

  if (state.loading) return <p className="text-[13px] text-ink-3">Memuat tiket…</p>;
  if (state.error) return <p className="text-[13px] text-bad">{state.error}</p>;
  if (state.tickets.length === 0) {
    return (
      <div className="py-6 text-center text-[13px] text-ink-3">
        <Ticket className="mx-auto mb-2 size-6 text-ink-3" aria-hidden="true" />
        Anda belum pernah membuat tiket.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {state.tickets.map((t) => (
        <Link key={t.id} href={`/bantuan/riwayat?ticket=${encodeURIComponent(t.ticketNumber)}`} className="flex flex-col gap-1 rounded-xl border border-line px-3 py-2.5 text-sm hover:border-accent hover:bg-accent-soft/40">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[12px] text-ink-3">{t.ticketNumber}</span>
            <Badge tone={FEEDBACK_STATUS_TONE[t.status]} dot>{FEEDBACK_STATUS_LABEL[t.status]}</Badge>
          </div>
          <span className="line-clamp-1 font-medium text-ink">{t.title}</span>
          <span className="text-[12px] text-ink-3">{FEEDBACK_KIND_LABEL[t.kind]}</span>
        </Link>
      ))}
      <Link href="/dtic/bantuan" className="mt-1 text-center text-[12px] font-medium text-accent hover:underline">Lihat semua tiket</Link>
    </div>
  );
}
