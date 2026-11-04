"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { internalRequest } from "@/lib/client/api";

/**
 * "Lanjutkan Pekerjaan" — mengakui penutupan otomatis karena SLA TANPA mengubah status pekerjaan (tidak
 * pernah terkunci, lihat resumeSlaOrder). Berbeda dari SlaConfirmButton (yang menandai benar-benar selesai).
 */
export function SlaResumeButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function resume() {
    setPending(true);
    setError(null);
    try {
      await internalRequest(`/api/internal/orders/${orderId}/sla-resume`, "POST", {});
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal melanjutkan.");
    } finally {
      setPending(false);
    }
  }

  if (done) return null;

  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" onClick={resume} loading={pending} icon={<PlayCircle className="size-4" aria-hidden="true" />} data-testid="sla-resume-button">
        Lanjutkan Pekerjaan
      </Button>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
