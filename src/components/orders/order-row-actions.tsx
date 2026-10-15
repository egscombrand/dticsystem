"use client";

import { Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { ApiError, internalAction, internalPreview, internalRequest, type ActionOutcome, type TelegramPreview } from "@/lib/client/api";

type Props = { orderId: string; orderNumber: string; title: string };

/**
 * Pratinjau + kirim ulang Telegram. Dirender hanya saat dibuka (state baru tiap sesi). Kunci idempoten dibuat
 * sekali per sesi: klik ganda atau retry dengan kunci yang sama tidak membuat dua pengiriman.
 */
function ResendDialog({ orderId, orderNumber, title, open, onClose }: Props & { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <ResendSession orderId={orderId} orderNumber={orderNumber} title={title} onClose={onClose} />;
}

function ResendSession({ orderId, orderNumber, onClose }: Props & { onClose: () => void }) {
  const [preview, setPreview] = useState<TelegramPreview | { error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [key] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionOutcome | null>(null);

  // Strict Mode menjalankan efek dua kali di development: GET pratinjau aman diulang (tanpa efek samping),
  // dan `alive` mencegah respons lama menimpa pratinjau yang lebih baru.
  useEffect(() => {
    let alive = true;
    void internalPreview(`/api/internal/orders/${orderId}/telegram/preview`).then((p) => {
      if (alive) setPreview(p);
    });
    return () => {
      alive = false;
    };
  }, [orderId, attempt]);

  function retryPreview() {
    setPreview(null);
    setAttempt((n) => n + 1);
  }

  async function send() {
    if (pending) return;
    setPending(true);
    setResult(null);
    const r = await internalAction(`/api/internal/orders/${orderId}/telegram`, "POST", { key });
    setResult(r);
    setPending(false);
  }

  // Tanpa tujuan pun tombol tetap bisa dipakai: permintaan masuk antrean "Menunggu Tujuan" (tidak ada klaim terkirim).
  const ready = preview !== null && "destination" in preview && preview.tokenConfigured;
  const noDestination = preview !== null && "destination" in preview && preview.destination.kind === "none";
  const needsSetup = noDestination || result?.code === "no_destination" || result?.code === "awaiting_destination";

  return (
    <Modal
      open
      onClose={() => !pending && onClose()}
      dismissible={!pending}
      title="Kirim ulang ke Telegram"
      description={<>Order <span className="font-mono text-ink">{orderNumber}</span>. Pesan dibuat dari data order yang tersimpan; data order tidak diubah.</>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Tutup</Button>
          <Button onClick={send} loading={pending} disabled={pending || !ready || result?.ok === true}>
            {result?.ok ? "Terkirim" : noDestination ? "Simpan ke antrean" : "Kirim ke Telegram"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {!preview && <p className="text-sm text-ink-3" aria-live="polite">Memuat pratinjau…</p>}
        {preview && "error" in preview && (
          <div className="flex flex-col items-start gap-2">
            <Alert kind="error">{preview.error}</Alert>
            <Button size="sm" variant="secondary" onClick={retryPreview}>Coba lagi</Button>
          </div>
        )}
        {preview && "text" in preview && (
          <>
            {"destination" in preview && !preview.tokenConfigured && <Alert kind="error">{preview.tokenProblem}</Alert>}
            {"destination" in preview && preview.tokenConfigured && preview.destination.kind === "none" && <Alert kind="error">{preview.destination.reason}</Alert>}
            <p className="text-left text-xs font-medium tracking-wide text-ink-3 uppercase">Pratinjau pesan</p>
            <pre className="max-h-96 overflow-auto rounded-lg border border-line bg-subtle p-3 text-left font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{preview.text}</pre>
          </>
        )}
        {result && <Alert kind={result.ok ? "success" : "error"}>{result.message}</Alert>}
        {needsSetup && (
          <Link href="/dtic/settings/integrations" className="text-sm font-semibold text-accent underline">
            Buka Integrasi Telegram
          </Link>
        )}
      </div>
    </Modal>
  );
}

function DeleteDialog({ orderId, orderNumber, title, open, onClose }: Props & { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <DeleteSession orderId={orderId} orderNumber={orderNumber} title={title} onClose={onClose} />;
}

function DeleteSession({ orderId, orderNumber, title, onClose }: Props & { onClose: () => void }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await internalRequest(`/api/internal/orders/${orderId}`, "DELETE");
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menghapus order. Coba lagi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => !pending && onClose()}
      dismissible={!pending}
      title="Hapus order?"
      description={
        <>
          Order <span className="font-mono text-ink">{orderNumber}</span> — {title} akan dihapus permanen beserta lampiran, riwayat status, dan antrean notifikasinya.
          Pesan Telegram yang sudah terkirim tidak dapat ditarik kembali. Nomor dan judul order tetap tercatat di audit.
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Batal</Button>
          <Button variant="danger" onClick={remove} loading={pending} disabled={confirm.trim() !== orderNumber}>Hapus Order</Button>
        </>
      }
    >
      <label htmlFor={`confirm-${orderId}`} className="mb-1.5 block text-[13px] text-ink-2">
        Ketik <span className="font-mono font-medium text-ink">{orderNumber}</span> untuk konfirmasi
      </label>
      <Input id={`confirm-${orderId}`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" disabled={pending} />
      {error && <Alert kind="error" className="mt-3">{error}</Alert>}
    </Modal>
  );
}

/** Aksi Super Admin per order di Daftar Order. Izin diperiksa di server; tombol ini hanya ditampilkan untuk Super Admin. */
export function OrderRowActions(props: Props) {
  const [resendOpen, setResendOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          icon={<Send className="size-3.5" aria-hidden="true" />}
          onClick={() => setResendOpen(true)}
          aria-label={`Kirim ulang ${props.orderNumber} ke Telegram`}
          title="Kirim ulang ke Telegram"
        >
          <span className="hidden xl:inline">Telegram</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 className="size-3.5 text-bad" aria-hidden="true" />}
          onClick={() => setDeleteOpen(true)}
          aria-label={`Hapus order ${props.orderNumber}`}
          title="Hapus order"
        >
          <span className="hidden xl:inline text-bad">Hapus</span>
        </Button>
      </div>
      <ResendDialog {...props} open={resendOpen} onClose={() => setResendOpen(false)} />
      <DeleteDialog {...props} open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </>
  );
}
