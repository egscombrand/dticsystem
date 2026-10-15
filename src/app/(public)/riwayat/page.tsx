import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { TrackingClient } from "@/components/tracking/tracking-client";
import { Skeleton } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Riwayat Request" };

/**
 * Halaman shell (judul) dirender langsung; pembacaan query (?order=…) dan pencarian dilakukan
 * di dalam <Suspense> agar tidak memblokir prerender (Cache Components).
 */
export default function RiwayatPage({ searchParams }: PageProps<"/riwayat">) {
  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-navy sm:text-[28px]">Riwayat Request</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-3">Cari request dengan nomor order untuk melihat status terkini dan progresnya.</p>
      </div>
      <Suspense fallback={<TrackingFallback />}>
        <TrackingHost searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function TrackingHost({ searchParams }: { searchParams: PageProps<"/riwayat">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const o = Array.isArray(sp.order) ? sp.order[0] : sp.order;
  return <TrackingClient initialOrderNumber={o ?? ""} />;
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
