import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { Skeleton } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Bantuan & Masukan" };

export default function BantuanPage({ searchParams }: PageProps<"/bantuan">) {
  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-navy sm:text-[28px]">Bantuan & Masukan</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-3">
          Laporkan bug, sampaikan saran perbaikan, usulkan fitur baru, atau ajukan pertanyaan seputar DTIC Connect. Laporan Anda akan ditinjau tim DTIC.
        </p>
        <p className="mt-2 text-[13px] text-ink-3">
          Sudah pernah melapor? <Link href="/bantuan/riwayat" className="font-medium text-teal hover:underline">Lacak tiket Anda</Link>.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-2xl" />}>
        <FormHost searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function FormHost({ searchParams }: { searchParams: PageProps<"/bantuan">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const o = Array.isArray(sp.order) ? sp.order[0] : sp.order;
  return <FeedbackForm initialOrderNumber={o ?? ""} />;
}
