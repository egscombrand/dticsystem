"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { internalRequest } from "@/lib/client/api";

export function DeleteOrderButton({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await internalRequest(`/api/internal/orders/${orderId}`, "DELETE");
      router.replace("/dtic/orders");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus order.");
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="secondary" icon={<Trash2 className="size-4 text-bad" />} onClick={() => { setOpen(true); setConfirm(""); setError(null); }}>
        Hapus
      </Button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        dismissible={!pending}
        title="Hapus order?"
        description={
          <>
            Order <span className="font-mono font-medium text-ink">{orderNumber}</span> beserta dokumen dan riwayat statusnya akan dihapus permanen.
            Tindakan ini tidak dapat dibatalkan.
          </>
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Batal</Button>
            <Button variant="danger" onClick={remove} loading={pending} disabled={confirm.trim() !== orderNumber}>
              Hapus permanen
            </Button>
          </>
        }
      >
        <label htmlFor="confirm-delete" className="mb-1.5 block text-[13px] text-ink-2">
          Ketik <span className="font-mono font-medium text-ink">{orderNumber}</span> untuk konfirmasi
        </label>
        <Input id="confirm-delete" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" disabled={pending} />
        {error && <Alert kind="error" className="mt-3">{error}</Alert>}
      </Modal>
    </>
  );
}
