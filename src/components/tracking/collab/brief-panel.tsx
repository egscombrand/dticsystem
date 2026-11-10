"use client";

import { History, Lock, Pencil } from "lucide-react";
import { useState } from "react";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import type { RichTextChange } from "@/components/rich-text/rich-text-editor";
import { RichTextView } from "@/components/rich-text/rich-text-view";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { ApiError, internalRequest } from "@/lib/client/api";
import { BRIEF_CHANGE_LABEL, briefChangeProblem, COLLAB_LIMITS, type BriefChange, type BriefVersion } from "@/lib/collab";
import { formatDateTime, formatLongDate } from "@/lib/dates";
import { plainTextToRichDoc } from "@/lib/rich-text";
import { isFinishedStatus } from "@/lib/status";
import type { CollabSection } from "@/lib/server/services/collab";

const SOURCE_LABEL: Record<BriefVersion["source"], string> = {
  original: "Brief awal",
  requester_change: "Usulan Pemohon diterima",
  staff_edit: "Diubah tim DTIC",
};

const CHANGE_TONE: Record<BriefChange["status"], string> = {
  pending: "bg-warn-soft text-warn",
  accepted: "bg-ok-soft text-ok",
  rejected: "bg-bad-soft text-bad",
  withdrawn: "bg-subtle text-ink-2",
};

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-ink-3">{k}</dt>
      <dd className="font-medium break-words text-ink">{v}</dd>
    </div>
  );
}

/**
 * Brief untuk Pemohon: BACA-SAJA. Pemohon tidak mengedit brief asli; ia mengusulkan perubahan (dengan alasan) yang
 * baru berlaku setelah PIC/Manager/Admin menerima, dan setiap perubahan tercatat sebagai versi baru.
 */
export function BriefPanel({ orderNumber, data, onChanged }: { orderNumber: string; data: CollabSection; onChanged: () => void }) {
  const { brief, versions, changes } = data;
  const closed = isFinishedStatus(brief.status);
  const pending = changes.find((c) => c.status === "pending") ?? null;
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState<RichTextChange | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ reason?: string; briefDoc?: string; form?: string }>({});
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [showVersions, setShowVersions] = useState(false);

  async function submit() {
    const text = proposal?.text ?? brief.brief;
    const problem = briefChangeProblem(reason, text, brief.brief);
    if (problem) return setErrors({ [problem.field]: problem.message });
    if (!proposal) return setErrors({ briefDoc: "Ubah isi brief terlebih dahulu." });
    setBusy(true);
    setErrors({});
    try {
      await internalRequest("/api/public/tracking/collab", "POST", { order: orderNumber, action: "brief_change", briefDoc: proposal.json, reason, requestKey });
      setOpen(false);
      setReason("");
      setProposal(null);
      setRequestKey(crypto.randomUUID());
      onChanged();
    } catch (e) {
      setErrors(e instanceof ApiError && e.fieldErrors ? { ...(e.fieldErrors as Record<string, string>), form: e.message } : { form: e instanceof ApiError ? e.message : "Usulan belum terkirim. Coba lagi." });
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(c: BriefChange) {
    setBusy(true);
    try {
      await internalRequest("/api/public/tracking/collab", "POST", { order: orderNumber, action: "brief_withdraw", changeId: c.id });
      onChanged();
    } catch (e) {
      setErrors({ form: e instanceof ApiError ? e.message : "Usulan belum dapat ditarik." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="brief-panel">
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="brief-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="brief-title" className="text-[15px] font-semibold text-navy">Brief Request</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-3 py-1 text-xs font-medium text-ink-2" data-testid="brief-readonly">
            <Lock className="size-3.5" aria-hidden="true" /> Hanya baca · Versi {versions[0]?.versionNo ?? 1}
          </span>
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
          <Row k="Judul" v={brief.title} />
          <Row k="Brand" v={brief.brandName} />
          <Row k="Jenis pekerjaan" v={brief.designType} />
          <Row k="Ukuran" v={brief.designSize} />
          <Row k="Prioritas" v={brief.priority} />
          <Row k="Pemohon" v={`${brief.requesterName} · ${brief.department}`} />
          <Row k="Dikirim" v={formatDateTime(brief.createdAt)} />
          <Row k="Deadline diminta" v={formatLongDate(brief.requestedDeadline)} />
          <Row k="Deadline disepakati" v={brief.agreedDeadline ? formatLongDate(brief.agreedDeadline) : "Belum disepakati"} />
        </dl>
        {brief.driveUrl && (
          <p className="mt-3 text-[13px]">
            <span className="text-ink-3">Tautan referensi: </span>
            <a href={brief.driveUrl} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className="font-medium break-all text-teal hover:underline">{brief.driveUrl}</a>
          </p>
        )}
        <div className="mt-4 rounded-xl border border-line/70 bg-subtle/40 p-4" data-testid="brief-content">
          <RichTextView doc={brief.briefRich} fallbackText={brief.brief} />
        </div>
        {!closed && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" icon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => { setOpen(true); setErrors({}); }} disabled={!!pending} data-testid="brief-propose">
              Usulkan perubahan
            </Button>
            <span className="text-[12.5px] text-ink-3">{pending ? "Masih ada usulan yang menunggu keputusan PIC." : "Brief tidak berubah sampai PIC menerima usulan Anda."}</span>
          </div>
        )}
      </section>

      {pending && (
        <section className="rounded-2xl border border-warn/30 bg-warn-soft/60 p-5 sm:p-6" data-testid="brief-pending" aria-labelledby="brief-pending-title">
          <h2 id="brief-pending-title" className="text-[15px] font-semibold text-navy">Usulan perubahan menunggu keputusan PIC</h2>
          <p className="mt-1 text-[13px] text-ink-2">Diajukan {formatDateTime(pending.createdAt)} berdasarkan versi {pending.basedOnVersion}.</p>
          <p className="mt-2 text-[13px] text-ink"><span className="font-medium">Alasan:</span> {pending.reason}</p>
          <div className="mt-3 rounded-xl bg-surface p-4"><RichTextView doc={pending.proposedBriefRich} fallbackText={pending.proposedBrief} /></div>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => void withdraw(pending)} loading={busy} data-testid="brief-withdraw">Tarik usulan</Button>
          {errors.form && <p role="alert" className="mt-2 text-[12.5px] text-bad">{errors.form}</p>}
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="brief-history-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="brief-history-title" className="text-[15px] font-semibold text-navy">Riwayat usulan & versi brief</h2>
          <Button size="sm" variant="ghost" icon={<History className="size-4" aria-hidden="true" />} onClick={() => setShowVersions((v) => !v)} aria-expanded={showVersions} data-testid="brief-versions-toggle">
            {showVersions ? "Sembunyikan versi" : `Lihat ${versions.length} versi`}
          </Button>
        </div>
        {changes.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-3">Belum ada usulan perubahan brief.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3" data-testid="brief-changes">
            {changes.map((c) => (
              <li key={c.id} className="rounded-xl border border-line/70 p-4 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={cn("rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", CHANGE_TONE[c.status])}>{BRIEF_CHANGE_LABEL[c.status]}</span>
                  <span className="text-[12px] text-ink-3">{formatDateTime(c.createdAt)}</span>
                </div>
                <p className="mt-2 text-ink"><span className="font-medium">Alasan:</span> {c.reason}</p>
                {c.decidedByName && <p className="mt-1 text-ink-2">Diputuskan oleh {c.decidedByName}{c.decidedAt ? ` · ${formatDateTime(c.decidedAt)}` : ""}{c.resultingVersionNo ? ` · menjadi versi ${c.resultingVersionNo}` : ""}</p>}
                {c.decisionNote && <p className="mt-1 text-ink-2">Catatan: {c.decisionNote}</p>}
              </li>
            ))}
          </ul>
        )}
        {showVersions && (
          <ol className="mt-4 flex flex-col gap-3 border-t border-line pt-4" data-testid="brief-versions">
            {versions.map((v) => (
              <li key={v.versionNo} className="rounded-xl border border-line/70 p-4">
                <p className="text-[13px] font-semibold text-navy">
                  Versi {v.versionNo} <span className="font-normal text-ink-3">· {SOURCE_LABEL[v.source]} · {v.createdByName} · {formatDateTime(v.createdAt)}</span>
                </p>
                <div className="mt-2"><RichTextView doc={v.briefRich} fallbackText={v.brief} /></div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        size="wide"
        title="Usulkan perubahan brief"
        description="Brief asli tidak langsung berubah. PIC akan meninjau usulan Anda; bila diterima, brief menjadi versi baru dan riwayatnya tersimpan."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Batal</Button>
            <Button onClick={() => void submit()} loading={busy} data-testid="brief-submit">Kirim usulan</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Isi brief yang diusulkan" htmlFor="brief-proposal" required error={errors.briefDoc}>
            <RichTextEditor id="brief-proposal" initialContent={brief.briefRich ?? plainTextToRichDoc(brief.brief)} placeholder="Tulis brief yang sudah diperbarui" onChange={setProposal} disabled={busy} invalid={!!errors.briefDoc} />
          </Field>
          <Field label="Alasan perubahan" htmlFor="brief-reason" required error={errors.reason} hint="Jelaskan singkat apa yang berubah dan mengapa.">
            <Textarea id="brief-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={COLLAB_LIMITS.briefReasonMaxChars} disabled={busy} data-testid="brief-reason" />
          </Field>
          {errors.form && <Alert kind="error">{errors.form}</Alert>}
        </div>
      </Modal>
    </div>
  );
}
