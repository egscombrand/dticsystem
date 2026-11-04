"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck2, CalendarClock, Gavel, Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { internalRequest } from "@/lib/client/api";
import { formatDateTime, formatDeadline, zonedLocalToUtc } from "@/lib/dates";
import {
  DEADLINE_AGREEMENT_META,
  DEADLINE_EVENT_LABEL,
  pendingChange,
  picCanDecide,
  type DeadlineAgreementStatus,
  type DeadlineEvent,
} from "@/lib/deadline-agreement";

export type DeadlineAgreementPanelProps = {
  orderId: string;
  status: DeadlineAgreementStatus;
  requestedDeadline: string;
  picEstimatedDeadline: string | null;
  agreedDeadline: string | null;
  events: DeadlineEvent[];
  canActAsPic: boolean;
  canResolve: boolean;
  finished: boolean;
};

type FormMode = "propose" | "change" | "resolve";

const FORM_COPY: Record<FormMode, { title: string; submit: string; reasonLabel: string; reasonHint: string }> = {
  propose: { title: "Usulkan waktu pengerjaan", submit: "Kirim usulan ke Pemohon", reasonLabel: "Alasan penyesuaian", reasonHint: "Wajib bila berbeda dari waktu yang diminta Pemohon." },
  change: { title: "Ajukan perubahan deadline", submit: "Kirim usulan perubahan", reasonLabel: "Alasan perubahan", reasonHint: "Deadline lama tetap berlaku sampai Pemohon menyetujui." },
  resolve: { title: "Tetapkan deadline final", submit: "Tetapkan deadline", reasonLabel: "Alasan keputusan", reasonHint: "Tercatat di riwayat kesepakatan." },
};

/**
 * Informasi & kesepakatan waktu pengerjaan (sisi internal). Pemohon menjawab lewat Riwayat Request publik —
 * panel ini hanya menampilkan statusnya; tidak ada percakapan, hanya alasan singkat per langkah.
 */
export function DeadlineAgreementPanel(p: DeadlineAgreementPanelProps) {
  const router = useRouter();
  const [mode, setMode] = useState<FormMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = DEADLINE_AGREEMENT_META[p.status];
  const change = p.status === "agreed" ? pendingChange(p.events) : null;
  const waitingRequester = p.status === "awaiting_requester" || change !== null;

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await internalRequest(`/api/internal/orders/${p.orderId}/deadline-agreement`, "POST", body);
      setMode(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-[15px]" data-testid="deadline-agreement">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={meta.tone} dot>
          <span data-testid="deadline-agreement-status">{meta.label}</span>
        </Badge>
      </div>
      <p className="text-sm text-ink-2">{meta.description}</p>
      <dl className="grid gap-2 text-sm">
        <Row label="Waktu diminta Pemohon" value={formatDeadline(p.requestedDeadline)} testId="requested-deadline" />
        <Row label="Estimasi PIC" value={p.picEstimatedDeadline ? formatDeadline(p.picEstimatedDeadline) : "Belum ada"} testId="pic-estimated-deadline" />
        <Row label="Deadline final disepakati" value={p.agreedDeadline ? formatDeadline(p.agreedDeadline) : "Belum disepakati"} testId="agreed-deadline" />
      </dl>

      {waitingRequester && !p.finished && (
        <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-ink" role="status">
          <Hourglass className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
          <span>
            {change ? `Usulan perubahan ke ${formatDeadline(change.proposedDeadline!)} menunggu persetujuan Pemohon. Deadline sepakat saat ini tetap berlaku.` : "Menunggu persetujuan Pemohon lewat halaman Riwayat Request."}
          </span>
        </p>
      )}
      {p.status !== "agreed" && !p.finished && (
        <p className="text-[13px] text-ink-3">Pekerjaan belum dapat dimulai dan SLA pengerjaan belum berjalan sampai waktu disepakati.</p>
      )}

      {!p.finished && mode === null && (
        <div className="flex flex-wrap gap-2">
          {p.canActAsPic && picCanDecide(p.status) && (
            <>
              <Button size="sm" onClick={() => send({ action: "accept_requested" })} loading={busy} icon={<CalendarCheck2 className="size-4" aria-hidden="true" />} data-testid="deadline-accept">
                Setujui waktu permintaan
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setMode("propose")} icon={<CalendarClock className="size-4" aria-hidden="true" />} data-testid="deadline-propose-open">
                Usulkan waktu lain
              </Button>
            </>
          )}
          {p.canActAsPic && p.status === "agreed" && !change && (
            <Button size="sm" variant="secondary" onClick={() => setMode("change")} icon={<CalendarClock className="size-4" aria-hidden="true" />} data-testid="deadline-change-open">
              Ajukan perubahan deadline
            </Button>
          )}
          {p.canResolve && p.status !== "agreed" && (
            <Button size="sm" variant="secondary" onClick={() => setMode("resolve")} icon={<Gavel className="size-4" aria-hidden="true" />} data-testid="deadline-resolve-open">
              Tetapkan deadline final
            </Button>
          )}
        </div>
      )}

      {mode && <DeadlineForm mode={mode} busy={busy} onCancel={() => setMode(null)} onSubmit={(deadlineAt, reason) => send({ action: mode === "resolve" ? "resolve" : "propose", deadlineAt, reason })} />}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}

      {p.events.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-2">Riwayat kesepakatan ({p.events.length})</summary>
          <ol className="mt-2 flex flex-col gap-2" data-testid="deadline-history">
            {p.events.map((e, i) => (
              <li key={i} className="rounded-lg bg-subtle px-3 py-2">
                <p className="font-medium text-ink">{DEADLINE_EVENT_LABEL[e.kind]}</p>
                <p className="text-[13px] text-ink-2">
                  {formatDateTime(e.at)}
                  {e.actorName ? ` · ${e.actorName}` : ""}
                  {e.proposedDeadline ? ` · ${formatDeadline(e.proposedDeadline)}` : ""}
                </p>
                {e.reason && <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-ink-2">{e.reason}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="font-medium text-ink" data-testid={testId}>{value}</dd>
    </div>
  );
}

function DeadlineForm({ mode, busy, onCancel, onSubmit }: { mode: FormMode; busy: boolean; onCancel: () => void; onSubmit: (deadlineAt: string, reason: string) => void }) {
  const copy = FORM_COPY[mode];
  const dtId = useId();
  const reasonId = useId();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const at = value ? zonedLocalToUtc(value) : null;
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-line p-3"
      data-testid={`deadline-form-${mode}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (at) onSubmit(at.toISOString(), reason.trim());
      }}
    >
      <p className="text-sm font-semibold text-ink">{copy.title}</p>
      <Field label="Tanggal & jam (WIB)" htmlFor={dtId} required>
        <Input id={dtId} type="datetime-local" step={900} value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
      </Field>
      <Field label={copy.reasonLabel} htmlFor={reasonId} required={mode !== "propose"} hint={copy.reasonHint}>
        <Textarea id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} disabled={busy} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={busy}>Batal</Button>
        <Button type="submit" size="sm" loading={busy} disabled={!at}>{copy.submit}</Button>
      </div>
    </form>
  );
}
