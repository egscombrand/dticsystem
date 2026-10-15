"use client";

import Link from "next/link";
import { Send } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { internalAction, internalPreview, type TelegramPreview } from "@/lib/client/api";

type Option = { id: string; orderNumber: string; title: string };

/** Tes Telegram: pesan uji koneksi, atau pesan uji dari data satu order (diberi awalan "PESAN UJI"). */
export function TelegramTestButton({ orders }: { orders: Option[] }) {
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [preview, setPreview] = useState<TelegramPreview | { error: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  /** Pilih sumber pesan uji; pratinjau dimuat saat pilihan berubah (bukan lewat effect). */
  function choose(id: string) {
    setOrderId(id);
    setPreview(null);
    if (!id) return;
    void internalPreview(`/api/internal/orders/${id}/telegram/preview?test=1`).then(setPreview);
  }

  function openDialog() {
    setOpen(true);
    setOrderId("");
    setPreview(null);
    setResult(null);
  }

  async function send() {
    if (pending) return;
    setPending(true);
    setResult(null);
    const r = orderId
      ? await internalAction("/api/internal/integrations/telegram/test-order", "POST", { orderId })
      : await internalAction("/api/internal/integrations/telegram/test", "POST");
    setResult(r);
    setPending(false);
  }

  return (
    <>
      <Button variant="secondary" size="sm" icon={<Send className="size-4" aria-hidden="true" />} onClick={openDialog}>
        Tes Telegram
      </Button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        dismissible={!pending}
        title="Tes Telegram"
        description="Pesan tes selalu diberi label PESAN UJI dan tidak masuk antrean notifikasi. Pesan ini bukan pekerjaan baru."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Tutup</Button>
            <Button onClick={send} loading={pending} disabled={pending || (preview !== null && "destination" in preview && (!preview.tokenConfigured || preview.destination.kind === "none"))}>
              Kirim pesan uji
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Sumber isi pesan uji" htmlFor="telegram-test-source" hint="Pilih order dari daftar ini, atau kirim pesan uji koneksi saja.">
            <Select id="telegram-test-source" value={orderId} onChange={(e) => choose(e.target.value)} disabled={pending}>
              <option value="">Pesan uji koneksi (tanpa data order)</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>{o.orderNumber} · {o.title}</option>
              ))}
            </Select>
          </Field>
          {orderId && preview && "text" in preview && (
            <>
              {"destination" in preview && !preview.tokenConfigured && <Alert kind="error">{preview.tokenProblem}</Alert>}
              {"destination" in preview && preview.tokenConfigured && preview.destination.kind === "none" && (
                <>
                  <Alert kind="error">{preview.destination.reason}</Alert>
                  <Link href="/dtic/settings/integrations" className="text-sm font-semibold text-accent underline">Buka Integrasi Telegram</Link>
                </>
              )}
              <pre className="max-h-80 overflow-auto rounded-lg border border-line bg-subtle p-3 text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{preview.text}</pre>
            </>
          )}
          {orderId && preview && "error" in preview && <Alert kind="error">{preview.error}</Alert>}
          {result && <Alert kind={result.ok ? "success" : "error"}>{result.message}</Alert>}
        </div>
      </Modal>
    </>
  );
}
