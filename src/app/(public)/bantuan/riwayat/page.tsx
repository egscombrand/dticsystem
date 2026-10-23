import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { FeedbackTrackingClient } from "@/components/feedback/feedback-tracking-client";
import { Skeleton } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Lacak Tiket Bantuan & Masukan" };

export default function BantuanRiwayatPage({ searchParams }: PageProps<"/bantuan/riwayat">) {
  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-navy sm:text-[28px]">Masukan Saya</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-3">Cari dengan nomor tiket untuk melihat status tindak lanjut laporan Anda.</p>
      </div>
      <Suspense fallback={<TrackingFallback />}>
        <TrackingHost searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function TrackingHost({ searchParams }: { searchParams: PageProps<"/bantuan/riwayat">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const t = Array.isArray(sp.ticket) ? sp.ticket[0] : sp.ticket;
  return <FeedbackTrackingClient initialTicketNumber={t ?? ""} />;
}

function TrackingFallback() {
  return (
    <div aria-busy="true" className="mx-auto max-w-xl rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
      <span className="sr-only">Memuat…</span>
      <Skeleton className="h-4 w-44" />
      <Skeleton className="mt-5 h-10 w-full" />
      <Skeleton className="mt-4 h-10 w-full" />
    </div>
  );
}
