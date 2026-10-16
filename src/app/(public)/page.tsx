import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/spinner";
import { ClipboardList } from "lucide-react";
import { SubmissionForm } from "@/components/orders/submission-form";
import { listBrands } from "@/lib/server/repositories/brands";
import { listOrderTypes, listPriorities, listTeamsWithMembers, resolveDefaultPriority } from "@/lib/server/repositories/master-data";

export const metadata: Metadata = {
  title: "Pengajuan Order Desain",
  description: "Ajukan kebutuhan desain brand Anda ke Department Creative IT (DTIC).",
};

/** Halaman utama `/` — form pengajuan untuk client/brand (publik, tanpa akses ke data internal). */
export default function HomeSubmitPage() {
  return (
    <>
      <header className="form-rise relative mb-8 overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#ecfdf5_0%,#f0fdfa_50%,#eff6ff_100%)] p-6 ring-1 ring-line sm:p-8">
        <span aria-hidden="true" className="hero-glow pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.35),transparent_70%)] blur-2xl" />
        <span aria-hidden="true" className="hero-glow pointer-events-none absolute -bottom-20 -left-12 size-64 rounded-full bg-[radial-gradient(circle,rgba(15,118,110,0.22),transparent_70%)] blur-2xl" />
        <div className="relative flex max-w-3xl flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-semibold tracking-wide text-white shadow-card">
            <ClipboardList className="size-3.5" aria-hidden="true" /> Form Pengajuan
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-navy sm:text-4xl">Ajukan Pekerjaan</h1>
          <p className="text-[15px] leading-relaxed text-ink-2">
            Isi kebutuhan desain atau IT Anda dalam empat langkah. Setelah tersimpan, Anda langsung menerima nomor pekerjaan untuk memantau progresnya.
          </p>
        </div>
      </header>
      <Suspense fallback={<SubmissionFormSkeleton />}>
        <SubmissionFormLoader />
      </Suspense>
    </>
  );
}

async function SubmissionFormLoader() {
  await connection();
  // Semua pilihan dibaca dari database (hanya data aktif; hanya field yang diperlukan dikirim ke browser).
  const [brands, orderTypes, priorities, defaultPriority, teams] = await Promise.all([
    listBrands({ activeOnly: true }),
    listOrderTypes({ activeOnly: true }),
    listPriorities({ activeOnly: true }),
    resolveDefaultPriority(),
    listTeamsWithMembers(),
  ]);
  return (
    <SubmissionForm
      brands={brands.map((b) => ({ id: b.id, name: b.name }))}
      // Hanya jenis yang termasuk sebuah tim; jenis tanpa tim tidak bisa diajukan (tidak ada penanggung jawab).
      orderTypes={orderTypes.filter((t) => t.teamId).map((t) => ({ id: t.id, name: t.name, requiresDetail: t.requiresDetail, teamId: t.teamId }))}
      priorities={priorities.map((p) => ({ code: p.code, name: p.name }))}
      defaultPriority={defaultPriority}
      // Tim aktif & anggota aktifnya (hanya id dan nama). PIC ditentukan server, bukan dipilih pemohon.
      teams={teams}
    />
  );
}

function SubmissionFormSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Memuat formulir…</span>
      {[4, 6, 3].map((n, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-5 shadow-card sm:p-7">
          <Skeleton className="h-4 w-36" />
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {Array.from({ length: n }).map((_, j) => (
              <div key={j}>
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="mt-2 h-10 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
