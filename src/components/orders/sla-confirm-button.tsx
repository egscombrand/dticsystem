"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { internalRequest } from "@/lib/client/api";

/**
 * "Konfirmasi Pekerjaan Selesai" — hanya tampil saat status order closed_sla (ditutup otomatis karena
 * SLA). Server memeriksa ulang kewenangan (PIC order ini / Super Admin) — lihat confirmSlaClosedComplete.
 */
export function SlaConfirmButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await internalRequest(`/api/internal/orders/${orderId}/sla-confirm`, "POST", {});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengonfirmasi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <Button onClick={confirm} loading={pending} icon={<CheckCircle2 className="size-4" aria-hidden="true" />} data-testid="sla-confirm-button">
        Konfirmasi Pekerjaan Selesai
      </Button>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
