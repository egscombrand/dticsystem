"use client";

import { CalendarClock } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { ApiError, internalRequest } from "@/lib/client/api";
import { formatDeadline, getZonedParts, toDateKey } from "@/lib/dates";
import { useRouter } from "next/navigation";

const REASON_MIN = 5;

/** Tombol + dialog "Ubah tenggat". Hanya dirender untuk role dengan orders.update (server tetap memeriksa). */
export function DeadlineChangeButton({ orderId, deadlineAt }: { orderId: string; deadlineAt: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const dateId = useId();
  const timeId = useId();
  const reasonId = useId();
  const current = new Date(deadlineAt);
  const parts = getZonedParts(current);
  const [date, setDate] = useState(toDateKey(current));
  const [time, setTime] = useState(`${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonOk = reason.trim().length >= REASON_MIN;
  const newDeadline = date ? new Date(`${date}T${time || "23:59"}:00+07:00`) : null;
  const unchanged = newDeadline !== null && newDeadline.getTime() === current.getTime();
  const canConfirm = Boolean(date) && reasonOk && !unchanged && !busy;

  function openDialog() {
    const p = getZonedParts(current);
    setDate(toDateKey(current));
    setTime(`${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`);
    setReason("");
    setError(null);
    setOpen(true);
  }

  async function confirm() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await internalRequest(`/api/internal/orders/${orderId}/deadline`, "PUT", { deadlineDate: date, deadlineTime: time || undefined, reason: reason.trim() });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Tenggat belum tersimpan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" icon={<CalendarClock className="size-4" />} onClick={openDialog}>
        Ubah tenggat
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Ubah tenggat pekerjaan"
        description="Perubahan tenggat tidak mengubah status pekerjaan dan tercatat di riwayat dengan alasan."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Batal</Button>
            <Button onClick={confirm} loading={busy} disabled={!canConfirm}>Konfirmasi tenggat baru</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="rounded-xl bg-subtle p-3 text-[13px] text-ink-2">
            <span className="font-medium text-ink">Tenggat saat ini:</span> {formatDeadline(deadlineAt)}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tanggal (WIB)" htmlFor={dateId} required>
              <Input id={dateId} type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
            </Field>
            <Field label="Jam (WIB)" htmlFor={timeId} hint="Kosongkan untuk akhir hari (23.59).">
              <Input id={timeId} type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
            </Field>
          </div>
          {newDeadline && (
            <p className="text-[13px] text-ink-2">
              <span className="font-medium text-ink">Tenggat baru:</span> {unchanged ? "sama dengan tenggat saat ini" : formatDeadline(newDeadline)}
            </p>
          )}
          <Field label="Alasan perubahan" htmlFor={reasonId} required hint={`Minimal ${REASON_MIN} karakter. Tersimpan di riwayat.`}>
            <Textarea id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} disabled={busy} invalid={reason.length > 0 && !reasonOk} />
          </Field>
          {error && <p role="alert" className="text-[12.5px] text-bad">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
