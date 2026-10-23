"use client";

import { AlertCircle, CheckCircle2, Paperclip, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { UPLOAD_LIMITS } from "@/lib/config/app";
import { ACCEPT_ATTRIBUTE, checkFileBasics, formatFileSize } from "@/lib/files";
import {
  FEEDBACK_IMPACT_LABEL,
  FEEDBACK_IMPACTS,
  FEEDBACK_KIND_LABEL,
  FEEDBACK_KINDS,
  FEEDBACK_PAGE_LABEL,
  FEEDBACK_PAGES,
  type FeedbackImpact,
  type FeedbackKind,
  type FeedbackPage,
} from "@/lib/validation/feedback";

type FieldErrors = Record<string, string>;

const DETAIL_HINT: Record<FeedbackKind, string> = {
  bug: 'Jelaskan: apa yang sedang Anda lakukan, langkah yang menyebabkan masalah, hasil yang muncul, dan hasil yang seharusnya terjadi.',
  suggestion: "Jelaskan kebutuhan Anda dan manfaat yang diharapkan dari perbaikan ini.",
  feature_request: "Jelaskan fitur yang Anda butuhkan dan manfaat yang diharapkan.",
  question: "Tulis pertanyaan Anda sejelas mungkin.",
};

export function FeedbackForm({ initialOrderNumber = "" }: { initialOrderNumber?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [relatedOrderNumber, setRelatedOrderNumber] = useState(initialOrderNumber);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFileError(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= UPLOAD_LIMITS.maxFiles) {
        setFileError(`Maksimal ${UPLOAD_LIMITS.maxFiles} lampiran.`);
        break;
      }
      const basic = checkFileBasics({ name: f.name, size: f.size });
      if (basic) {
        setFileError(basic);
        continue;
      }
      next.push(f);
    }
    setFiles(next);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current || busy) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const fd = new FormData(formRef.current);
    fd.delete("attachments");
    for (const f of files) fd.append("attachments", f);
    try {
      const res = await fetch("/api/public/feedback", { method: "POST", headers: { "X-DTIC-Request": "1" }, body: fd });
      const body = (await res.json().catch(() => ({}))) as { ticketNumber?: string; error?: string; fieldErrors?: FieldErrors };
      if (!res.ok) {
        setError(body.error ?? "Laporan belum tersimpan. Coba lagi.");
        if (body.fieldErrors) setFieldErrors(body.fieldErrors);
        return;
      }
      setTicketNumber(body.ticketNumber ?? null);
    } catch {
      setError("Laporan belum terkirim. Periksa koneksi Anda lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  if (ticketNumber) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-line bg-surface p-6 text-center shadow-card sm:p-8">
        <CheckCircle2 className="mx-auto size-10 text-teal" aria-hidden="true" />
        <h2 className="mt-4 text-lg font-semibold text-navy">Laporan terkirim</h2>
        <p className="mt-2 text-sm text-ink-3">Nomor tiket Anda:</p>
        <p className="mt-1 font-mono text-xl font-semibold text-navy">{ticketNumber}</p>
        <p className="mt-3 text-[13px] text-ink-3">Simpan nomor ini untuk melacak status laporan Anda.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href={`/bantuan/riwayat?ticket=${encodeURIComponent(ticketNumber)}`} className="inline-flex items-center justify-center rounded-lg bg-navy px-4 py-2.5 text-sm font-medium text-white hover:bg-navy/90">
            Lihat Status Tiket
          </Link>
          <Button variant="ghost" onClick={() => setTicketNumber(null)}>Buat Laporan Lain</Button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="mx-auto max-w-2xl rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7" noValidate>
      <div className="flex flex-col gap-4">
        <Field label="Jenis Laporan" htmlFor="kind" required error={fieldErrors.kind}>
          <Select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind)} disabled={busy}>
            {FEEDBACK_KINDS.map((k) => <option key={k} value={k}>{FEEDBACK_KIND_LABEL[k]}</option>)}
          </Select>
        </Field>

        <Field label="Judul Laporan" htmlFor="title" required error={fieldErrors.title} hint='Contoh: "Tombol persetujuan tidak berfungsi."'>
          <Input id="title" name="title" maxLength={160} disabled={busy} invalid={!!fieldErrors.title} />
        </Field>

        <Field label="Halaman atau Fitur Terkait" htmlFor="relatedPage" required error={fieldErrors.relatedPage}>
          <Select id="relatedPage" name="relatedPage" defaultValue="home" disabled={busy}>
            {FEEDBACK_PAGES.map((p: FeedbackPage) => <option key={p} value={p}>{FEEDBACK_PAGE_LABEL[p]}</option>)}
          </Select>
        </Field>

        <Field label="Detail Laporan" htmlFor="detail" required error={fieldErrors.detail} hint={DETAIL_HINT[kind]}>
          <Textarea id="detail" name="detail" maxLength={5000} className="min-h-32" disabled={busy} invalid={!!fieldErrors.detail} />
        </Field>

        {kind === "bug" && (
          <Field label="Tingkat Dampak" htmlFor="impact" required error={fieldErrors.impact} hint="Tingkat dampak yang Anda rasakan — bukan prioritas final yang ditetapkan tim DTIC.">
            <Select id="impact" name="impact" defaultValue="" disabled={busy}>
              <option value="" disabled>Pilih tingkat dampak</option>
              {FEEDBACK_IMPACTS.map((i: FeedbackImpact) => <option key={i} value={i}>{FEEDBACK_IMPACT_LABEL[i]}</option>)}
            </Select>
          </Field>
        )}

        <Field label="Nomor Request Terkait" htmlFor="relatedOrderNumber" error={fieldErrors.relatedOrderNumber} hint="Opsional. Contoh: DTIC-2026-00008.">
          <Input id="relatedOrderNumber" name="relatedOrderNumber" className="font-mono" placeholder="DTIC-2026-00012" value={relatedOrderNumber} onChange={(e) => setRelatedOrderNumber(e.target.value)} disabled={busy} invalid={!!fieldErrors.relatedOrderNumber} />
        </Field>

        <Field label="Nama Anda" htmlFor="reporterName" required error={fieldErrors.reporterName} hint="Dipakai tim DTIC untuk menghubungi Anda bila diperlukan.">
          <Input id="reporterName" name="reporterName" maxLength={120} disabled={busy} invalid={!!fieldErrors.reporterName} />
        </Field>

        <Field label="Kontak (WhatsApp/Email)" htmlFor="reporterContact" error={fieldErrors.reporterContact} hint="Opsional.">
          <Input id="reporterContact" name="reporterContact" maxLength={160} disabled={busy} invalid={!!fieldErrors.reporterContact} />
        </Field>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink">Lampiran (opsional)</span>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-ink-2 hover:border-accent">
            <Paperclip className="size-4" aria-hidden="true" />
            Pilih screenshot atau file pendukung (maks. {UPLOAD_LIMITS.maxFiles}, {formatFileSize(UPLOAD_LIMITS.maxFileSizeBytes)}/file)
            <input type="file" multiple accept={ACCEPT_ATTRIBUTE} className="sr-only" disabled={busy} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </label>
          {fileError && <p className="mt-1.5 text-[12.5px] text-bad">{fileError}</p>}
          {files.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-subtle px-3 py-1.5 text-[13px] text-ink">
                  <span className="min-w-0 truncate">{f.name} · {formatFileSize(f.size)}</span>
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} disabled={busy} className="shrink-0 rounded p-0.5 text-ink-3 hover:bg-line hover:text-ink" aria-label={`Hapus ${f.name}`}>
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p role="alert" className="flex items-start gap-2 text-[13px] text-bad">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {error}
          </p>
        )}

        <Button type="submit" loading={busy} className="bg-navy hover:bg-navy/90">{busy ? "Mengirim…" : "Kirim Laporan"}</Button>
      </div>
    </form>
  );
}
