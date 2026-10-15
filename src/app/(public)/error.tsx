"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function SubmitError({ retry }: { error: Error; retry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <Alert kind="error" title="Formulir belum dapat dimuat">
        Layanan sedang tidak tersedia. Silakan coba beberapa saat lagi.
      </Alert>
      <Button variant="secondary" onClick={() => retry()}>Coba lagi</Button>
    </div>
  );
}
