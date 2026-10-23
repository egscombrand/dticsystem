"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { ApiError, internalRequest } from "@/lib/client/api";
import {
  FEEDBACK_PRIORITIES,
  FEEDBACK_PRIORITY_LABEL,
  FEEDBACK_STATUS_LABEL,
  FEEDBACK_STATUSES,
  type FeedbackPriority,
  type FeedbackStatus,
} from "@/lib/validation/feedback";

type Assignee = { id: string; fullName: string };

export function FeedbackActions({
  ticketId,
  status,
  priority,
  assigneeUserId,
  assignees,
  resolutionSummary,
  closeReason,
}: {
  ticketId: string;
  status: FeedbackStatus;
  priority: FeedbackPriority | null;
  assigneeUserId: string | null;
  assignees: Assignee[];
  resolutionSummary: string | null;
  closeReason: string | null;
}) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusDialog, setStatusDialog] = useState<FeedbackStatus | null>(null);
  const [message, setMessage] = useState("");

  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteDone, setNoteDone] = useState(false);

  async function changePriority(value: string) {
    setBusy(true);
    setError(null);
    try {
      await internalRequest(`/api/internal/feedback/${ticketId}/priority`, "POST", { priority: value || null });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Prioritas belum tersimpan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  async function changeAssignee(value: string) {
    setBusy(true);
    setError(null);
    try {
      await internalRequest(`/api/internal/feedback/${ticketId}/assignee`, "POST", { assigneeUserId: value || null });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Penanggung jawab belum tersimpan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  function openStatus(next: FeedbackStatus) {
    setMessage(next === "done" ? (resolutionSummary ?? "") : next === "wont_fix" ? (closeReason ?? "") : "");
    setError(null);
    setStatusDialog(next);
  }

  async function confirmStatus() {
    if (!statusDialog) return;
    if (statusDialog === "wont_fix" && !message.trim()) {
      setError("Alasan wajib diisi untuk Tidak Ditindaklanjuti.");
      return;
    }
    if (statusDialog === "need_info" && !message.trim()) {
      setError("Tulis pertanyaan yang perlu dijawab pelapor.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = { status: statusDialog };
      if (statusDialog === "wont_fix") body.closeReason = message.trim();
      else if (statusDialog === "done") body.resolutionSummary = message.trim();
      else if (statusDialog === "need_info") body.message = message.trim();
      await internalRequest(`/api/internal/feedback/${ticketId}/status`, "POST", body);
      setStatusDialog(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Status belum tersimpan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    setNoteBusy(true);
    setError(null);
    try {
      await internalRequest(`/api/internal/feedback/${ticketId}/note`, "POST", { message: note.trim() });
      setNote("");
      setNoteDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Catatan belum tersimpan. Coba lagi.");
    } finally {
      setNoteBusy(false);
    }
  }

  const needsMessage = statusDialog === "wont_fix" || statusDialog === "need_info";
  const messageLabel = statusDialog === "wont_fix" ? "Alasan tidak ditindaklanjuti" : statusDialog === "need_info" ? "Pertanyaan untuk pelapor" : "Ringkasan penyelesaian (opsional)";

  return (
    <div className="flex flex-col gap-5">
      {error && <p role="alert" className="text-[13px] text-bad">{error}</p>}

      <Field label="Status tindak lanjut" htmlFor={`${uid}-status`}>
        <Select id={`${uid}-status`} value={status} onChange={(e) => openStatus(e.target.value as FeedbackStatus)} disabled={busy}>
          {FEEDBACK_STATUSES.map((s) => <option key={s} value={s}>{FEEDBACK_STATUS_LABEL[s]}</option>)}
        </Select>
      </Field>

      <Field label="Prioritas internal" htmlFor={`${uid}-priority`}>
        <Select id={`${uid}-priority`} defaultValue={priority ?? ""} onChange={(e) => void changePriority(e.target.value)} disabled={busy}>
          <option value="">Belum ditetapkan</option>
          {FEEDBACK_PRIORITIES.map((p) => <option key={p} value={p}>{FEEDBACK_PRIORITY_LABEL[p]}</option>)}
        </Select>
      </Field>

      <Field label="Penanggung jawab" htmlFor={`${uid}-assignee`}>
        <Select id={`${uid}-assignee`} defaultValue={assigneeUserId ?? ""} onChange={(e) => void changeAssignee(e.target.value)} disabled={busy}>
          <option value="">Belum ditetapkan</option>
          {assignees.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
        </Select>
      </Field>

      <div className="border-t border-line pt-4">
        <Field label="Tambah catatan internal" htmlFor={`${uid}-note`} hint="Tidak terlihat oleh pelapor.">
          <Textarea id={`${uid}-note`} value={note} onChange={(e) => { setNote(e.target.value); setNoteDone(false); }} maxLength={3000} className="min-h-20" disabled={noteBusy} />
        </Field>
        <Button size="sm" variant="secondary" className="mt-2" loading={noteBusy} disabled={!note.trim()} onClick={() => void addNote()}>
          {noteDone ? "Tersimpan" : "Simpan Catatan"}
        </Button>
      </div>

      <Modal
        open={statusDialog !== null}
        onClose={() => { if (!busy) setStatusDialog(null); }}
        title={statusDialog ? `Ubah status ke "${FEEDBACK_STATUS_LABEL[statusDialog]}"?` : ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setStatusDialog(null)} disabled={busy}>Batal</Button>
            <Button onClick={() => void confirmStatus()} loading={busy} variant={statusDialog === "wont_fix" ? "danger" : "primary"}>Simpan</Button>
          </>
        }
      >
        <Field label={messageLabel} htmlFor={`${uid}-msg`} required={needsMessage}>
          <Textarea id={`${uid}-msg`} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={3000} className="min-h-24" disabled={busy} />
        </Field>
      </Modal>
    </div>
  );
}
