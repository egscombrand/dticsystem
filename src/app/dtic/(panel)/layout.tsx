import { Suspense } from "react";
import { PanelShell } from "@/components/layout/panel-shell";
import { LoadingHint } from "@/components/ui/loading-hint";
import { Skeleton } from "@/components/ui/spinner";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="min-h-screen p-6">
          <span className="sr-only">Memeriksa sesi…</span>
          <div className="mx-auto max-w-xl pt-16">
            <LoadingHint label="Memeriksa sesi Anda…" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      }
    >
      <PanelShell>{children}</PanelShell>
    </Suspense>
  );
}
