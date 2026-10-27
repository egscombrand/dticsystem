"use client";

import { AlertCircle, CheckCircle2, Clock3, Download, Eye, Search, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { ApiError, internalRequest } from "@/lib/client/api";
import { formatDateTime, formatLongDate } from "@/lib/dates";
import { PREVIEWABLE_MIME } from "@/lib/files";
import type { OrderStatus } from "@/lib/status";
import { clientStatusLabel, trackingStages } from "@/lib/tracking-labels";
import type { TrackingView } from "@/lib/server/services/tracking";
import type { PublicDelivery } from "@/lib/server/repositories/orders";

const isImageMime = (m: string) => m === "image/png" || m === "image/webp" || m === "image/jpeg";
const fileUrl = (orderNumber: string, fileId: string, inline?: boolean) =>
  `/api/public/tracking/files/${fileId}?order=${encodeURIComponent(orderNumber)}${inline ? "&inline=1" : ""}`;

/** Nomor order diformat ulang di sisi klien (huruf besar, tanpa spasi) — sama dengan server. */
const normalize = (v: string) => v.trim().toUpperCase().replace(/\s+/g, "");

function Timeline({ view }: { view: TrackingView }) {
  // Tahap utama + tahap tambahan hanya bila pernah tercatat di riwayat (data database).
  const seen = new Set(view.history.map((h) => h.status));
  const stages = trackingStages(view.status, seen);
  const current = stages.indexOf(view.status);
  const timeOf = (s: OrderStatus) => view.history.filter((h) => h.status === s).at(-1)?.changedAt;

  return (
    <ol data-tour="riwayat-timeline" aria-label="Progres request" className="relative flex flex-col">
      {stages.map((s, i) => {
        // Manager sudah ACC (status pindah ke awaiting_requester) tapi PIC belum benar-benar
        // mengajukan ke pemohon — tahap ini belum boleh terlihat "selesai"/tercapai.
        const pendingSubmission = s === "awaiting_requester" && view.awaitingSubmissionToRequester;
        const reached = i <= current && (view.history.some((h) => h.status === s) || i === 0) && !pendingSubmission;
        const isCurrent = s === view.status;
        const at = timeOf(s);
        const { label, hint } = clientStatusLabel(s, view.awaitingSubmissionToRequester);
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
                {label}
                {isCurrent && <span className="ml-2 rounded-full bg-teal/10 px-2 py-0.5 text-[11px] font-medium text-teal">Saat ini</span>}
              </p>
              <p className="mt-0.5 text-[13px] text-ink-3">{hint}</p>
              {at && <p className="mt-1 text-[12px] text-ink-3">{formatDateTime(at)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Hasil yang BENAR-BENAR sudah diajukan ke pemohon (view.deliveries, satu entri per peristiwa
 * delivery_recorded — lihat getPublicDeliveries). Draf internal PIC yang belum diajukan tidak pernah
 * tersedia di sini karena sumbernya murni peristiwa delivery_recorded, bukan daftar lampiran order.
 */
type PreviewFile = { id: string; fileName: string; mimeType: string };

const DECISION_BADGE: Record<PublicDelivery["decision"], { label: string; className: string } | null> = {
  awaiting: null,
  approved: { label: "Disetujui Pemohon", className: "bg-teal/10 text-teal" },
  revision_requested: { label: "Revisi Diminta", className: "bg-warn/10 text-warn" },
};

/**
 * CTA keputusan (Setujui Hasil / Minta Revisi) HANYA untuk pengajuan TERBARU yang benar-benar masih
 * menunggu (decision "awaiting") — pengajuan lama tetap tampil sebagai riwayat, tidak pernah bisa
 * diputuskan ulang, sama seperti aturan backend (deriveRequesterDecision di qc.ts).
 */
function DeliveriesSection({ view, onDecided }: { view: TrackingView; onDecided: (next: TrackingView) => void }) {
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [decisionDialog, setDecisionDialog] = useState<{ delivery: PublicDelivery; mode: "approve" | "revision" } | null>(null);
  const [revisionNote, setRevisionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const requestKeyRef = useState(() => crypto.randomUUID())[0];

  function openDecision(delivery: PublicDelivery, mode: "approve" | "revision") {
    setDecisionDialog({ delivery, mode });
    setRevisionNote("");
    setDecisionError(null);
  }

  async function confirmDecision() {
    if (!decisionDialog) return;
    const { delivery, mode } = decisionDialog;
    if (mode === "revision" && !revisionNote.trim()) {
      setDecisionError("Catatan revisi wajib diisi.");
      return;
    }
    setBusy(true);
    setDecisionError(null);
    try {
      const next = await internalRequest<TrackingView>("/api/public/tracking/decision", "POST", {
        orderNumber: view.orderNumber,
        deliveryId: delivery.id,
        decision: mode === "approve" ? "approved" : "revision",
        note: mode === "revision" ? revisionNote.trim() : undefined,
        requestKey: requestKeyRef,
      });
      setDecisionDialog(null);
      onDecided(next);
    } catch (err) {
      setDecisionError(err instanceof ApiError ? err.message : "Keputusan belum tersimpan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-tour="riwayat-hasil" className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="deliveries-title">
      <h2 id="deliveries-title" className="text-[15px] font-semibold text-navy">File Hasil yang Diajukan</h2>
      {!view.deliveries.length ? (
        <p className="mt-2 text-[13px] text-ink-3">Belum ada hasil yang diajukan kepada Anda.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {view.deliveries.map((d: PublicDelivery, i) => (
            <div key={d.at} className="rounded-xl border border-line/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-navy">
                  Pengajuan #{i + 1}
                  {i === view.deliveries.length - 1 && (
                    <span className="rounded-full bg-teal/10 px-2 py-0.5 text-[11px] font-medium text-teal">Terbaru</span>
                  )}
                  {DECISION_BADGE[d.decision] && (
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", DECISION_BADGE[d.decision]!.className)}>
                      {DECISION_BADGE[d.decision]!.label}
                    </span>
                  )}
                </p>
                <p className="text-[12px] text-ink-3">{formatDateTime(d.at)}</p>
              </div>
              {d.decision === "revision_requested" && d.decisionNote && (
                <p className="mt-2 rounded-lg bg-warn/5 px-3 py-2 text-[13px] text-ink">
                  <span className="font-medium text-warn">Catatan revisi Anda{d.decisionAt ? ` (${formatDateTime(d.decisionAt)})` : ""}:</span> {d.decisionNote}
                </p>
              )}
              {!d.files.length && !d.links.length ? (
                <p className="mt-2 text-[12px] text-ink-3">Tidak ada berkas yang tercatat untuk pengajuan ini.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {d.files.map((f) => {
                    const previewable = PREVIEWABLE_MIME.has(f.mimeType);
                    return (
                      <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg bg-subtle/60 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={f.fileName}>
                          {f.fileName}
                          {!previewable && <span className="ml-1.5 text-[11px] text-ink-3">(pratinjau tidak didukung)</span>}
                        </span>
                        <span className="flex shrink-0 gap-1">
                          {previewable &&
                            (isImageMime(f.mimeType) ? (
                              <button
                                type="button"
                                onClick={() => setPreview(f)}
                                className="inline-flex items-center gap-1 rounded-lg p-1.5 text-ink-2 hover:bg-subtle hover:text-ink"
                                aria-label={`Lihat ${f.fileName}`}
                                title="Lihat"
                              >
                                <Eye className="size-4" aria-hidden="true" />
                              </button>
                            ) : (
                              <a
                                href={fileUrl(view.orderNumber, f.id, true)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg p-1.5 text-ink-2 hover:bg-subtle hover:text-ink"
                                aria-label={`Lihat ${f.fileName}`}
                                title="Lihat"
                              >
                                <Eye className="size-4" aria-hidden="true" />
                              </a>
                            ))}
                          <a
                            href={fileUrl(view.orderNumber, f.id)}
                            className="inline-flex items-center gap-1 rounded-lg p-1.5 text-teal hover:bg-teal/10"
                            aria-label={`Unduh ${f.fileName}`}
                            title="Unduh"
                          >
                            <Download className="size-4" aria-hidden="true" />
                          </a>
                        </span>
                      </li>
                    );
                  })}
                  {d.links.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 rounded-lg bg-subtle/60 px-3 py-2">
                      <span className="min-w-0 truncate text-[13px] text-ink">{l.title}</span>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        referrerPolicy="no-referrer"
                        className="shrink-0 text-[12px] font-medium text-teal hover:underline"
                      >
                        Buka
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {d.decision === "awaiting" && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line/70 pt-3">
                  <Button data-tour="riwayat-setujui" size="sm" icon={<CheckCircle2 className="size-4" aria-hidden="true" />} onClick={() => openDecision(d, "approve")} className="bg-teal hover:bg-teal/90">
                    Setujui Hasil
                  </Button>
                  <Button data-tour="riwayat-revisi" size="sm" variant="secondary" icon={<Undo2 className="size-4" aria-hidden="true" />} onClick={() => openDecision(d, "revision")}>
                    Minta Revisi
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview?.fileName ?? ""}
        footer={
          preview ? (
            <a href={fileUrl(view.orderNumber, preview.id)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-teal hover:underline">
              <Download className="size-4" aria-hidden="true" /> Unduh
            </a>
          ) : undefined
        }
      >
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- berkas dari endpoint publik berautorisasi, bukan aset Next/Image
          <img src={fileUrl(view.orderNumber, preview.id, true)} alt={preview.fileName} className="max-h-[70vh] w-full rounded-lg object-contain" />
        )}
      </Modal>

      <Modal
        open={decisionDialog !== null}
        onClose={() => { if (!busy) setDecisionDialog(null); }}
        title={decisionDialog?.mode === "approve" ? "Setujui hasil ini?" : "Minta revisi"}
        description={
          decisionDialog?.mode === "approve"
            ? "Persetujuan Anda akan tercatat dan pekerjaan dilanjutkan ke tahap penyelesaian oleh tim DTIC."
            : "Tuliskan apa yang perlu diperbaiki agar tim DTIC tidak perlu menebak."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDecisionDialog(null)} disabled={busy}>Batal</Button>
            <Button
              onClick={() => void confirmDecision()}
              loading={busy}
              disabled={decisionDialog?.mode === "revision" && !revisionNote.trim()}
              variant={decisionDialog?.mode === "revision" ? "danger" : "primary"}
            >
              {decisionDialog?.mode === "approve" ? "Ya, Setujui Hasil" : "Kirim Permintaan Revisi"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[15px]">
          {decisionDialog?.mode === "revision" && (
            <Field label="Catatan revisi" htmlFor="revision-note" required hint="Wajib diisi — dikirim ke PIC agar bisa ditindaklanjuti.">
              <Textarea id="revision-note" value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} maxLength={1000} className="min-h-24" disabled={busy} />
            </Field>
          )}
          {decisionError && <p role="alert" className="text-sm text-bad">{decisionError}</p>}
        </div>
      </Modal>
    </section>
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

        <section data-tour="riwayat-status" className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7" aria-labelledby="progress-title">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <h2 id="progress-title" className="text-[15px] font-semibold text-navy">Progres request</h2>
            <span className="rounded-full bg-teal/10 px-3 py-1 text-xs font-semibold text-teal">{clientStatusLabel(view.status, view.awaitingSubmissionToRequester).label}</span>
          </div>
          <Timeline view={view} />
        </section>

        {view.awaitingSubmissionToRequester && (
          <Alert kind="info">Hasil sudah disetujui secara internal. Tim DTIC akan mengajukan hasil final kepada Anda sebentar lagi.</Alert>
        )}

        {view.awaitingClosure && (
          <Alert kind="info">Anda sudah menyetujui hasil ini — tim DTIC sedang menyelesaikan proses penutupan pekerjaan.</Alert>
        )}

        <DeliveriesSection view={view} onDecided={setView} />

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
            data-tour="riwayat-cari"
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
