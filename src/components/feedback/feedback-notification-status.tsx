"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { ApiError, internalRequest } from "@/lib/client/api";
import type { FeedbackNotificationAttempt, FeedbackNotificationStatus } from "@/lib/server/repositories/feedback-telegram";

const STATUS_LABEL: Record<FeedbackNotificationStatus["status"], string> = {
  pending: "Menunggu dikirim",
  processing: "Sedang dikirim",
  sent: "Terkirim",
  failed: "Gagal",
};
const STATUS_TONE: Record<FeedbackNotificationStatus["status"], "neutral" | "accent" | "success" | "danger"> = {
  pending: "neutral",
  processing: "accent",
  sent: "success",
  failed: "danger",
};
const KIND_LABEL: Record<"auto" | "manual", string> = { auto: "Otomatis", manual: "Manual" };

/**
 * Status, tombol kirim/kirim ulang, dan riwayat notifikasi Telegram untuk satu tiket — Super Admin saja
 * (lihat halaman detail tiket). Tombol selalu mengirim SEKARANG lewat backend nyata (bukan simulasi),
 * dan hasil yang ditampilkan adalah respons Telegram sebenarnya, tidak pernah diklaim berhasil lebih dulu.
 */
export function FeedbackNotificationStatusCard({
  ticketId,
  status,
  attempts,
}: {
  ticketId: string;
  status: FeedbackNotificationStatus | null;
  attempts: FeedbackNotificationAttempt[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const r = await internalRequest<{ ok: boolean; message: string }>(`/api/internal/feedback/${ticketId}/notification`, "POST", {});
      setResult(r);
    } catch (err) {
      setResult({ ok: false, message: err instanceof ApiError ? err.message : "Permintaan gagal. Coba lagi." });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">Notifikasi Telegram</p>
        {status && <Badge tone={STATUS_TONE[status.status]} dot>{STATUS_LABEL[status.status]}</Badge>}
      </div>
      {status && (
        <p className="mt-1 text-xs text-ink-3">
          {status.status === "sent" && status.sentAt ? `Terkirim ${formatDateTime(status.sentAt)}` : `Percobaan antrean: ${status.attempts}`}
        </p>
      )}
      {status?.status === "failed" && status.lastError && <p className="mt-1 text-xs text-bad">{status.lastError}</p>}
      {result && <p className={`mt-2 text-xs ${result.ok ? "text-ok" : "text-bad"}`}>{result.message}</p>}

      <Button className="mt-2" variant="secondary" size="sm" onClick={send} loading={busy} disabled={busy} icon={<Send className="size-3.5" aria-hidden="true" />}>
        Kirim ke Telegram
      </Button>

      {attempts.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs font-medium text-ink-3">Riwayat pengiriman</p>
          <ol className="mt-2 flex flex-col gap-2">
            {attempts.map((a) => (
              <li key={a.id} className="text-xs">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={a.status === "sent" ? "success" : "danger"} dot>{a.status === "sent" ? "Berhasil" : "Gagal"}</Badge>
                  <span className="text-ink-3">{KIND_LABEL[a.kind]}</span>
                  <span className="text-ink-3">· {formatDateTime(a.attemptedAt)}</span>
                  {a.actorName && <span className="text-ink-3">· oleh {a.actorName}</span>}
                </span>
                {a.error && <p className="mt-0.5 text-bad">{a.error}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
