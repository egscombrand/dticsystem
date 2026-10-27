"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { internalRequest } from "@/lib/client/api";
import { STATUS_META, statusLabel, type OrderStatus } from "@/lib/status";
import type { Transition } from "@/lib/workflow";

/**
 * Tombol perubahan status. Daftar aksi dihitung server (allowedTransitions) sesuai pelaku;
 * server tetap memeriksa ulang setiap permintaan.
 */
export function StatusChanger({ orderId, status, actions, compact }: { orderId: string; status: OrderStatus; actions: Transition[]; compact?: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [active, setActive] = useState<Transition | null>(null);

  async function run(t: Transition) {
    if (t.note.required && !note.trim()) {
      setActive(t);
      setMsg({ kind: "error", text: `${t.note.label} wajib diisi.` });
      return;
    }
    setPending(true);
    setMsg(null);
    try {
      await internalRequest(`/api/internal/orders/${orderId}/status`, "POST", { status: t.to, note: note.trim() || undefined });
      setNote("");
      setActive(null);
      setMsg({ kind: "success", text: `Status diubah menjadi ${statusLabel(t.to)}.` });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Gagal mengubah status." });
    } finally {
      setPending(false);
    }
  }

  if (actions.length === 0) {
    if (compact) return null;
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-2">Status saat ini: <span className="font-medium">{STATUS_META[status].label}</span></p>
        <p className="text-xs text-ink-3">Tidak ada perubahan status yang bisa Anda lakukan untuk request ini.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="status-changer">
      {!compact && <p className="text-sm text-ink-2">Status saat ini: <span className="font-medium">{STATUS_META[status].label}</span></p>}
      <div className="flex flex-wrap gap-2">
        {actions.map((t) => (
          <Button key={t.to + t.action} variant={t.to === "cancelled" ? "danger" : compact && t.to === "in_progress" ? "primary" : "secondary"} size={compact && t.to === "in_progress" ? "md" : "sm"} className={compact && t.to === "in_progress" ? "w-full justify-center" : undefined} disabled={pending} onClick={() => (t.note.required ? setActive(t) : void run(t))}>
            {t.action}
          </Button>
        ))}
      </div>
      {active && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <label htmlFor="status-note" className="text-[13px] font-medium text-ink">{active.note.label}</label>
          <Textarea id="status-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-16" disabled={pending} />
          <div className="flex gap-2">
            <Button size="sm" loading={pending} onClick={() => void run(active)}>{active.action}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setActive(null); setNote(""); }}>Batal</Button>
          </div>
        </div>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </div>
  );
}
