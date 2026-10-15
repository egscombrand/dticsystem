import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { requireSession } from "@/lib/server/auth";
import { LiveDisplay } from "@/components/display/live-display";

export const metadata: Metadata = { title: "Live Order Display", robots: { index: false, follow: false } };

/** Layar display di luar layout panel (tanpa sidebar admin). Wajib sesi login; proxy juga memeriksa cookie. */
export default function DisplayPage() {
  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center bg-[#050b16] text-2xl text-[#9ca3af]">Memuat…</div>}>
      <DisplayGate />
    </Suspense>
  );
}

async function DisplayGate() {
  await connection();
  await requireSession();
  return <LiveDisplay />;
}
