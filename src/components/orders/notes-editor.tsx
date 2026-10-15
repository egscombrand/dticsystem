"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { internalRequest } from "@/lib/client/api";

export function NotesEditor({ orderId, notes }: { orderId: string; notes: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(notes ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function save() {
    setPending(true);
    setMsg(null);
    try {
      await internalRequest(`/api/internal/orders/${orderId}/notes`, "PUT", { internalNotes: value });
      setEditing(false);
      setMsg({ kind: "success", text: "Catatan internal tersimpan." });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Gagal menyimpan catatan." });
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-3">
        {notes ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink">{notes}</p>
        ) : (
          <p className="text-sm text-ink-3">Belum ada catatan internal.</p>
        )}
        <div>
          <Button size="sm" variant="secondary" onClick={() => { setValue(notes ?? ""); setEditing(true); setMsg(null); }}>
            {notes ? "Edit catatan" : "Tambah catatan"}
          </Button>
        </div>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="internal-notes" className="sr-only">Catatan internal</label>
      <Textarea id="internal-notes" value={value} onChange={(e) => setValue(e.target.value)} maxLength={10000} className="min-h-32" autoFocus disabled={pending} />
      <p className="text-xs text-ink-3">Hanya terlihat oleh tim DTIC. {value.length.toLocaleString("id-ID")}/10.000 karakter.</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} loading={pending}>Simpan</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>Batal</Button>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </div>
  );
}
