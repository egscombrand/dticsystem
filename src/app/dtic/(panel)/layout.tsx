import { Suspense } from "react";
import { PanelShell } from "@/components/layout/panel-shell";
import { Skeleton } from "@/components/ui/spinner";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="min-h-screen p-6">
          <span className="sr-only">Memeriksa sesi…</span>
          <Skeleton className="h-16 w-full max-w-md" />
        </div>
      }
    >
      <PanelShell>{children}</PanelShell>
    </Suspense>
  );
}
