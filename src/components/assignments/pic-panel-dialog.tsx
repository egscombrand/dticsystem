"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Textarea } from "@/components/ui/form";
import { ApiError, internalRequest } from "@/lib/client/api";
import { formatDate } from "@/lib/dates";
import type { Assignee, MemberOption } from "@/lib/types";
import { recommendCandidates, type MemberWorkload } from "@/lib/workload";

const REASON_MIN = 5;

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
/** Label operasi; "Pindah" = semua PIC lama dilepas dan diganti PIC baru (sama dengan aturan server). */
export const picOperationOf = (added: string[], removed: string[], kept = 1) =>
  added.length && removed.length ? (kept === 0 ? "Pindah" : "Ganti") : added.length ? "Tambah" : removed.length ? "Hapus" : "Tidak ada perubahan";

/**
 * Panel "Kelola PIC" (dipakai detail pekerjaan dan Distribusi Pekerjaan). Pilih anggota tim, lihat ringkasan
 * perubahan, isi alasan, lalu konfirmasi. Tidak menyimpan otomatis; server memvalidasi ulang dan menolak
 * bila PIC sudah diubah pengguna lain (expectedMemberIds). Rekomendasi hanya informasi.
 */
export function PicPanelDialog({
  orderId,
  orderLabel,
  open,
  onClose,
  assignees,
  members,
  workloads = [],
  onSaved,
}: {
  orderId: string;
  orderLabel: string;
  open: boolean;
  onClose: () => void;
  assignees: Assignee[];
  /** Anggota aktif dari tim kategori pekerjaan (sudah difilter server). */
  members: MemberOption[];
  workloads?: MemberWorkload[];
  /** Dipanggil setelah server menyimpan; `ids` = PIC terbaru dari respons server. */
  onSaved: (text: string, ids: string[]) => void;
}) {
  const reasonId = useId();
  const currentIds = assignees.map((a) => a.id);
  const [draft, setDraft] = useState<string[]>(currentIds);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(open);
  // Setiap kali panel dibuka ulang, draft mengikuti PIC terkini (bukan sisa pilihan sebelumnya).
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setDraft(currentIds);
      setReason("");
      setError(null);
    }
  }

  // Kandidat: anggota tim + PIC lama yang sudah di luar tim/nonaktif (agar bisa dilepas).
  const candidates: { id: string; name: string; note: string | null }[] = [
    ...members.map((m) => ({ id: m.id, name: m.name, note: m.division })),
    ...assignees
      .filter((a) => !members.some((m) => m.id === a.id))
      .map((a) => ({ id: a.id, name: a.name, note: "di luar tim atau nonaktif" })),
  ];
  const nameOf = (id: string) => candidates.find((c) => c.id === id)?.name ?? id;
  const loadOf = (id: string) => workloads.find((w) => w.memberId === id);
  const recommendation = recommendCandidates(workloads.filter((w) => members.some((m) => m.id === w.memberId)));
  const recommended = (id: string) => (recommendation.kind === "suggest" ? recommendation.reasons[id] : undefined);
  const added = draft.filter((id) => !currentIds.includes(id));
  const removed = currentIds.filter((id) => !draft.includes(id));
  const kept = currentIds.filter((id) => draft.includes(id)).length;
  const changed = !sameSet(draft, currentIds);
  const reasonOk = reason.trim().length >= REASON_MIN;
  const canConfirm = changed && draft.length > 0 && reasonOk && !busy;

  function toggle(id: string) {
    setError(null);
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  }

  async function confirm() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      const res = await internalRequest<{ changed: boolean; notification: "queued" | "failed" | null; assignees: { id: string }[] }>(`/api/internal/orders/${orderId}/assignees`, "PUT", {
        memberIds: draft,
        reason: reason.trim(),
        expectedMemberIds: currentIds,
      });
      // Status penyimpanan PIC dan status notifikasi Telegram ditampilkan terpisah.
      const saved = res.changed ? `Tersimpan — ${picOperationOf(added, removed, kept)} PIC. Sekarang ${draft.length} PIC.` : "Tidak ada perubahan.";
      onSaved(res.notification === "failed" ? `${saved} Notifikasi Telegram gagal dijadwalkan; hubungi Super Admin.` : saved, res.assignees.map((a) => a.id));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Perubahan PIC gagal disimpan. Coba lagi.";
      setError(err instanceof ApiError && err.fieldErrors?.memberIds ? `${message} ${err.fieldErrors.memberIds}` : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Kelola PIC"
      description={`${orderLabel}. Pilih anggota tim yang bertanggung jawab. Sistem tidak memindahkan PIC secara otomatis.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button onClick={confirm} loading={busy} disabled={!canConfirm}>
            Konfirmasi perubahan PIC
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-medium text-ink">Anggota tim</legend>
          <p className="text-[12.5px] text-ink-3" data-testid="pic-recommendation">
            {recommendation.kind === "suggest"
              ? "Rekomendasi berdasarkan jumlah pekerjaan aktif dan keterlambatan. Keputusan tetap di tangan Anda."
              : recommendation.message}
          </p>
          {candidates.map((c) => {
            const load = loadOf(c.id);
            const reason = recommended(c.id);
            return (
              <label key={c.id} className="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2 text-sm" data-testid="pic-candidate" data-member={c.name}>
                <input type="checkbox" className="mt-0.5" checked={draft.includes(c.id)} onChange={() => toggle(c.id)} disabled={busy} aria-label={c.name} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5 text-ink">
                    {c.name}
                    {reason && <span className="rounded-full bg-ok-soft px-1.5 py-px text-[11px] font-medium text-ok ring-1 ring-ok/30">Disarankan</span>}
                  </span>
                  {c.note && <span className="text-[12.5px] text-ink-3">{c.note}</span>}
                  {load && (
                    <span className="text-[12.5px] text-ink-2" data-testid="pic-workload">
                      {load.active} pekerjaan aktif · {load.overdue} terlambat · {load.onHold} ditunda
                      {load.nearestDeadline ? ` · deadline terdekat ${formatDate(load.nearestDeadline)}` : ""}
                    </span>
                  )}
                  {reason && <span className="text-[12px] text-ok">{reason}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="rounded-xl bg-subtle p-3 text-[13px] text-ink-2" data-testid="pic-diff">
          <p>
            <span className="font-medium text-ink">PIC sebelumnya:</span> {currentIds.length ? currentIds.map(nameOf).join(", ") : "belum ada"}
          </p>
          <p>
            <span className="font-medium text-ink">PIC baru:</span> {draft.length ? draft.map(nameOf).join(", ") : "belum ada (pilih minimal satu)"}
          </p>
          {changed && (
            <p>
              <span className="font-medium text-ink">Operasi:</span> {picOperationOf(added, removed, kept)}
              {added.length > 0 && <> · Ditambahkan: {added.map(nameOf).join(", ")}</>}
              {removed.length > 0 && <> · Dihapus: {removed.map(nameOf).join(", ")}</>}
            </p>
          )}
          {!changed && <p className="text-ink-3">Belum ada perubahan.</p>}
        </div>

        <Field label="Alasan perubahan" htmlFor={reasonId} required hint={`Minimal ${REASON_MIN} karakter. Tersimpan di riwayat perubahan.`}>
          <Textarea id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} disabled={busy} invalid={reason.length > 0 && !reasonOk} />
        </Field>

        {draft.length === 0 && <p className="text-[12.5px] text-bad">Pilih minimal satu PIC.</p>}
        {error && (
          <p role="alert" className="text-[12.5px] text-bad">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
