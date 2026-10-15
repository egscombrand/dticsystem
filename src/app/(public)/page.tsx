import { ClipboardCheck, FileText, Hash } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { SubmissionForm } from "@/components/orders/submission-form";
import { Skeleton } from "@/components/ui/spinner";
import { listBrands } from "@/lib/server/repositories/brands";
import { listOrderTypes, listPriorities, listTeamsWithMembers, resolveDefaultPriority } from "@/lib/server/repositories/master-data";

export const metadata: Metadata = {
  title: "Pengajuan Order Desain",
  description: "Ajukan kebutuhan desain brand Anda ke Department Creative IT (DTIC).",
};

const STEPS = [
  { icon: FileText, title: "Isi formulir", text: "Lengkapi data pemohon, brief, dan deadline." },
  { icon: Hash, title: "Terima nomor order", text: "Nomor DTIC tampil setelah pengajuan tersimpan." },
  { icon: ClipboardCheck, title: "Diproses tim DTIC", text: "Gunakan nomor order untuk menanyakan progres." },
];

/** Halaman utama `/` — form pengajuan untuk client/brand (publik, tanpa akses ke data internal). */
export default function HomeSubmitPage() {
  return (
    <>
      <div className="mb-8">
        <p className="text-[12px] font-semibold tracking-[0.14em] text-teal uppercase">DTIC Connect · One Portal for Creative &amp; IT Requests</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy sm:text-[30px]">Satu pintu untuk semua kebutuhan kreatif dan IT Anda.</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-3">
          Ajukan kebutuhan brand Anda ke Department Creative IT, lalu pantau progresnya melalui satu portal yang sama: dari request diterima hingga selesai.
        </p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="flex gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-card">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">
                  <span className="text-ink-3">{i + 1}.</span> {title}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
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
