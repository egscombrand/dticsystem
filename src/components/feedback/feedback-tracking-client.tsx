"use client";

import { AlertCircle, Download, Eye, MessageSquareReply, Paperclip, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { ApiError, internalRequest } from "@/lib/client/api";
import { formatDateTime } from "@/lib/dates";
import { PREVIEWABLE_MIME } from "@/lib/files";
import { FEEDBACK_KIND_LABEL, type FeedbackKind } from "@/lib/validation/feedback";

type PublicFeedbackView = {
  ticketNumber: string;
  kind: FeedbackKind;
  title: string;
  statusLabel: string;
  createdAt: string;
  updates: { at: string; message: string | null; kind: string }[];
  attachments: { id: string; fileName: string; mimeType: string; fileSize: number }[];
  awaitingReply: boolean;
};

const normalize = (v: string) => v.trim().toUpperCase().replace(/\s+/g, "");
const isImageMime = (m: string) => m === "image/png" || m === "image/webp" || m === "image/jpeg";
const fileUrl = (ticketNumber: string, fileId: string, inline?: boolean) => `/api/public/feedback/attachments/${fileId}?ticket=${encodeURIComponent(ticketNumber)}${inline ? "&inline=1" : ""}`;

const UPDATE_LABEL: Record<string, string> = {
  created: "Laporan diterima",
  status_changed: "Status diperbarui",
  info_requested: "Tim DTIC meminta informasi tambahan",
  info_provided: "Anda menjawab",
  resolved: "Laporan diselesaikan",
  wont_fix: "Laporan tidak ditindaklanjuti",
};

export function FeedbackTrackingClient({ initialTicketNumber }: { initialTicketNumber?: string }) {
  const [ticketNumber, setTicketNumber] = useState(initialTicketNumber ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<PublicFeedbackView | null>(null);
  const [preview, setPreview] = useState<{ id: string; fileName: string } | null>(null);
  const [reply, setReply] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialTicketNumber) return;
    const timer = window.setTimeout(() => void lookup(initialTicketNumber), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookup(raw: string) {
    const t = normalize(raw);
    if (!/^FB-\d{4}-\d{5,}$/.test(t)) return setError("Format nomor tiket tidak valid, contoh: FB-2026-00012.");
    setPending(true);
    setError(null);
    try {
      const data = await internalRequest<PublicFeedbackView>("/api/public/feedback/lookup", "POST", { ticketNumber: t });
      setView(data);
      setTicketNumber(t);
    } catch (err) {
      setView(null);
      setError(
        err instanceof ApiError && err.status === 429
          ? err.message
          : err instanceof ApiError && err.status === 404
            ? "Nomor tiket tidak ditemukan. Periksa kembali nomor yang Anda terima saat melapor."
            : err instanceof Error
              ? err.message
              : "Pencarian gagal. Coba lagi.",
      );
    } finally {
      setPending(false);
    }
  }

  async function sendReply() {
    if (!view || !reply.trim()) {
      setReplyError("Jawaban wajib diisi.");
      return;
    }
    setReplyBusy(true);
    setReplyError(null);
    try {
      const data = await internalRequest<PublicFeedbackView>("/api/public/feedback/reply", "POST", { ticketNumber: view.ticketNumber, message: reply.trim() });
      setView(data);
      setReply("");
    } catch (err) {
      setReplyError(err instanceof ApiError ? err.message : "Jawaban belum terkirim. Coba lagi.");
    } finally {
      setReplyBusy(false);
    }
  }

  if (view) {
    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">Nomor tiket</p>
              <p className="mt-1 font-mono text-xl font-semibold text-navy">{view.ticketNumber}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setView(null); setError(null); }}>Cari nomor lain</Button>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-4">
            <div><dt className="text-ink-3">Jenis</dt><dd className="font-medium text-ink">{FEEDBACK_KIND_LABEL[view.kind]}</dd></div>
            <div><dt className="text-ink-3">Judul</dt><dd className="font-medium text-ink">{view.title}</dd></div>
            <div><dt className="text-ink-3">Tanggal lapor</dt><dd className="font-medium text-ink">{formatDateTime(view.createdAt)}</dd></div>
            <div><dt className="text-ink-3">Status</dt><dd><span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-[12px] font-semibold text-teal">{view.statusLabel}</span></dd></div>
          </dl>
        </div>

        {view.attachments.length > 0 && (
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h2 className="text-[15px] font-semibold text-navy">Lampiran</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {view.attachments.map((f) => {
                const previewable = PREVIEWABLE_MIME.has(f.mimeType);
                return (
                  <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg bg-subtle/60 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 truncate text-[13px] text-ink" title={f.fileName}><Paperclip className="size-3.5 shrink-0 text-ink-3" aria-hidden="true" />{f.fileName}</span>
                    <span className="flex shrink-0 gap-1">
                      {previewable && isImageMime(f.mimeType) && (
                        <button type="button" onClick={() => setPreview(f)} className="inline-flex items-center gap-1 rounded-lg p-1.5 text-ink-2 hover:bg-subtle hover:text-ink" aria-label={`Lihat ${f.fileName}`} title="Lihat">
                          <Eye className="size-4" aria-hidden="true" />
                        </button>
                      )}
                      <a href={fileUrl(view.ticketNumber, f.id)} className="inline-flex items-center gap-1 rounded-lg p-1.5 text-teal hover:bg-teal/10" aria-label={`Unduh ${f.fileName}`} title="Unduh">
                        <Download className="size-4" aria-hidden="true" />
                      </a>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
          <h2 className="text-[15px] font-semibold text-navy">Riwayat Pembaruan</h2>
          {view.updates.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-3">Belum ada pembaruan.</p>
          ) : (
            <ol className="mt-3 flex flex-col gap-3">
              {view.updates.map((u, i) => (
                <li key={i} className="border-l-2 border-teal/30 pl-3">
                  <p className="text-[13px] font-medium text-ink">{UPDATE_LABEL[u.kind] ?? u.kind}</p>
                  {u.message && <p className="mt-0.5 text-[13px] text-ink-2 whitespace-pre-wrap">{u.message}</p>}
                  <p className="mt-0.5 text-[12px] text-ink-3">{formatDateTime(u.at)}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        {view.awaitingReply && (
          <section className="rounded-2xl border border-teal/25 bg-teal/5 p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-navy"><MessageSquareReply className="size-4" aria-hidden="true" /> Tim DTIC meminta informasi tambahan</h2>
            <p className="mt-1 text-[13px] text-ink-3">Lihat pertanyaan pada Riwayat Pembaruan di atas, lalu jawab di sini.</p>
            <Field label="Jawaban Anda" htmlFor="reply" required className="mt-3" error={replyError ?? undefined}>
              <Textarea id="reply" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={3000} className="min-h-24" disabled={replyBusy} />
            </Field>
            <Button className="mt-3 bg-teal hover:bg-teal/90" loading={replyBusy} onClick={() => void sendReply()}>Kirim Jawaban</Button>
          </section>
        )}

        <Modal open={preview !== null} onClose={() => setPreview(null)} title={preview?.fileName ?? ""}>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element -- berkas dari endpoint publik berautorisasi
            <img src={fileUrl(view.ticketNumber, preview.id, true)} alt={preview.fileName} className="max-h-[70vh] w-full rounded-lg object-contain" />
          )}
        </Modal>
      </div>
    );
  }

  return (
    <form
      className="mx-auto max-w-xl rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7"
      onSubmit={(e) => { e.preventDefault(); if (!pending) void lookup(ticketNumber); }}
      noValidate
    >
      <h2 className="text-[15px] font-semibold text-navy">Cari tiket Anda</h2>
      <p className="mt-1 text-[13px] text-ink-3">Masukkan nomor tiket yang Anda terima saat melapor. Contoh: FB-2026-00012.</p>
      <div className="mt-5 flex flex-col gap-4">
        <Field label="Nomor Tiket" htmlFor="track-ticket" required>
          <Input
            data-tour="bantuan-lacak"
            id="track-ticket"
            value={ticketNumber}
            onChange={(e) => setTicketNumber(e.target.value)}
            autoComplete="off"
            placeholder="FB-2026-00012"
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
          {pending ? "Mencari…" : "Lacak Tiket"}
        </Button>
      </div>
      {!view && !error && !pending && <Alert kind="info" className="mt-5">Data diambil langsung dari sistem DTIC.</Alert>}
    </form>
  );
}
