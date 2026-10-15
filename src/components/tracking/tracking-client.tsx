"use client";

import { AlertCircle, CheckCircle2, Clock3, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, Input } from "@/components/ui/form";
import { ApiError, internalRequest } from "@/lib/client/api";
import { formatDateTime, formatLongDate } from "@/lib/dates";
import type { OrderStatus } from "@/lib/status";
import { CLIENT_STATUS_LABEL, trackingStages } from "@/lib/tracking-labels";
import type { TrackingView } from "@/lib/server/services/tracking";

/** Nomor order diformat ulang di sisi klien (huruf besar, tanpa spasi) — sama dengan server. */
const normalize = (v: string) => v.trim().toUpperCase().replace(/\s+/g, "");

function Timeline({ view }: { view: TrackingView }) {
  // Tahap utama + tahap tambahan hanya bila pernah tercatat di riwayat (data database).
  const seen = new Set(view.history.map((h) => h.status));
  const stages = trackingStages(view.status, seen);
  const current = stages.indexOf(view.status);
  const timeOf = (s: OrderStatus) => view.history.filter((h) => h.status === s).at(-1)?.changedAt;

  return (
    <ol aria-label="Progres request" className="relative flex flex-col">
      {stages.map((s, i) => {
        const reached = i <= current && (view.history.some((h) => h.status === s) || i === 0);
        const isCurrent = s === view.status;
        const at = timeOf(s);
        return (
          <li key={s} className="relative flex gap-4 pb-6 last:pb-0">
            {i < stages.length - 1 && (
              <span className={cn("absolute top-7 bottom-0 left-[13px] w-0.5", i < current ? "bg-teal" : "bg-line")} aria-hidden="true" />
            )}
            <span
              className={cn(
                "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-surface",
                isCurrent ? "bg-teal text-white" : reached ? "bg-teal/15 text-teal" : "bg-subtle text-ink-3",
              )}
              aria-hidden="true"
            >
              {reached ? <CheckCircle2 className="size-4" /> : <Clock3 className="size-3.5" />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn("text-sm font-semibold", isCurrent ? "text-navy" : reached ? "text-ink" : "text-ink-3")}>
                {CLIENT_STATUS_LABEL[s].label}
                {isCurrent && <span className="ml-2 rounded-full bg-teal/10 px-2 py-0.5 text-[11px] font-medium text-teal">Saat ini</span>}
              </p>
              <p className="mt-0.5 text-[13px] text-ink-3">{CLIENT_STATUS_LABEL[s].hint}</p>
              {at && <p className="mt-1 text-[12px] text-ink-3">{formatDateTime(at)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function TrackingClient({ initialOrderNumber }: { initialOrderNumber?: string }) {
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<TrackingView | null>(null);

  // Nomor dari tautan (?order=…) langsung dicari setelah mount — tidak perlu isi ulang manual.
  useEffect(() => {
    if (!initialOrderNumber) return;
    const timer = window.setTimeout(() => void lookup(initialOrderNumber), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookup(raw: string) {
    const o = normalize(raw);
    if (!/^DTIC-\d{4}-\d{5,}$/.test(o)) return setError("Format nomor order tidak valid, contoh: DTIC-2026-00012.");
    setPending(true);
    setError(null);
    try {
      const data = await internalRequest<TrackingView>("/api/public/tracking", "POST", { orderNumber: o });
      setView(data);
      setOrderNumber(o);
    } catch (err) {
      setView(null);
      setError(
        err instanceof ApiError && err.status === 429
          ? err.message
          : err instanceof ApiError && err.status === 404
            ? "Nomor order tidak ditemukan. Periksa kembali nomor yang Anda terima saat pengajuan."
            : err instanceof Error
              ? err.message
              : "Pencarian gagal. Coba lagi.",
      );
    } finally {
      setPending(false);
    }
  }

  if (view) {
    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">Nomor order</p>
              <p className="mt-1 font-mono text-xl font-semibold text-navy">{view.orderNumber}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setView(null); setError(null); }}>Cari nomor lain</Button>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-5">
            <div><dt className="text-ink-3">Tanggal pengajuan</dt><dd className="font-medium text-ink">{formatDateTime(view.createdAt)}</dd></div>
            <div><dt className="text-ink-3">Brand pemohon</dt><dd className="font-medium text-ink">{view.brandName}</dd></div>
            <div><dt className="text-ink-3">Jenis order</dt><dd className="font-medium text-ink">{view.designType}</dd></div>
            <div><dt className="text-ink-3">Deadline</dt><dd className="font-medium text-ink">{formatLongDate(view.deadlineAt)}</dd></div>
            <div><dt className="text-ink-3">PIC</dt><dd className="font-medium text-ink">{view.picNames.length ? view.picNames.join(", ") : "Belum ada PIC"}</dd></div>
          </dl>
        </div>

        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7" aria-labelledby="progress-title">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <h2 id="progress-title" className="text-[15px] font-semibold text-navy">Progres request</h2>
            <span className="rounded-full bg-teal/10 px-3 py-1 text-xs font-semibold text-teal">{CLIENT_STATUS_LABEL[view.status].label}</span>
          </div>
          <Timeline view={view} />
        </section>

        {view.requesterMessage && (
          <section className="rounded-2xl border border-teal/25 bg-teal/5 p-5 sm:p-6" aria-labelledby="msg-title">
            <h2 id="msg-title" className="text-[15px] font-semibold text-navy">Pesan dari tim DTIC</h2>
            <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-ink">{view.requesterMessage}</p>
          </section>
        )}

        {view.resultUrl && (
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="result-title">
            <h2 id="result-title" className="text-[15px] font-semibold text-navy">Hasil pekerjaan</h2>
            <a href={view.resultUrl} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className="mt-2 inline-block break-all text-sm font-medium text-teal hover:underline">
              Buka hasil pekerjaan
            </a>
          </section>
        )}
      </div>
    );
  }

  return (
    <form
      className="mx-auto max-w-xl rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) void lookup(orderNumber);
      }}
      noValidate
    >
      <h2 className="text-[15px] font-semibold text-navy">Cari request Anda</h2>
      <p className="mt-1 text-[13px] text-ink-3">Masukkan nomor order yang Anda terima saat pengajuan. Contoh: DTIC-2026-00012.</p>
      <div className="mt-5 flex flex-col gap-4">
        <Field label="Nomor Order" htmlFor="track-order" required>
          <Input
            id="track-order"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            autoComplete="off"
            placeholder="DTIC-2026-00012"
            className="font-mono"
            disabled={pending}
            invalid={!!error}
            aria-describedby={error ? "track-error" : undefined}
          />
        </Field>
        {error && (
          <p id="track-error" role="alert" className="flex items-start gap-2 text-[13px] text-bad">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {error}
          </p>
        )}
        <Button type="submit" loading={pending} icon={<Search className="size-4" />} className="bg-navy hover:bg-navy/90">
          {pending ? "Mencari…" : "Lacak Request"}
        </Button>
      </div>
      {!view && !error && !pending && <Alert kind="info" className="mt-5">Data diambil langsung dari sistem DTIC. Riwayat tampil setelah nomor order ditemukan.</Alert>}
    </form>
  );
}
