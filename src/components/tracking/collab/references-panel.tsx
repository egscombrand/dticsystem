"use client";

import { Download, FileText, Paperclip, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/client/api";
import { collabPostForm } from "@/lib/client/collab-api";
import { COLLAB_LIMITS, type ReferenceFile } from "@/lib/collab";
import { formatDateTime } from "@/lib/dates";
import { ACCEPT_ATTRIBUTE, ALLOWED_EXTENSIONS_LABEL, formatFileSize } from "@/lib/files";

const href = (order: string, id: string, inline?: boolean) =>
  `/api/public/tracking/collab-file/${id}?order=${encodeURIComponent(order)}&kind=reference${inline ? "&inline=1" : ""}`;

/** Berkas referensi dari Pemohon: lampiran saat pengajuan + tambahan setelahnya. Berkas lama tidak pernah ditimpa. */
export function ReferencesPanel({ orderNumber, references, closed, onChanged }: { orderNumber: string; references: ReferenceFile[]; closed: boolean; onChanged: () => void }) {
  const [picked, setPicked] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload() {
    if (picked.length === 0) return setError("Pilih berkas yang ingin ditambahkan.");
    if (picked.length > COLLAB_LIMITS.referenceMaxFiles) return setError(`Maksimal ${COLLAB_LIMITS.referenceMaxFiles} berkas per unggahan.`);
    if (picked.reduce((s, f) => s + f.size, 0) > COLLAB_LIMITS.referenceMaxBytesPerUpload) return setError("Total ukuran per unggahan maksimal 4 MB.");
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("order", orderNumber);
      for (const f of picked) form.append("attachments", f);
      await collabPostForm("/api/public/tracking/references", form);
      setPicked([]);
      if (input.current) input.current.value = "";
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Berkas belum terunggah. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="refs-title" data-testid="references-panel">
      <h2 id="refs-title" className="text-[15px] font-semibold text-navy">Berkas referensi dari Anda</h2>
      {references.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3" data-testid="references-empty">Belum ada berkas referensi.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2" data-testid="references-list">
          {references.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-subtle/60 px-3 py-2">
              <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-ink">
                <FileText className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
                <span className="truncate" title={r.fileName}>{r.fileName}</span>
                <span className="shrink-0 text-[11.5px] text-ink-3">{formatFileSize(r.fileSize)}</span>
                {r.addedLater && <span className="shrink-0 rounded-full bg-brand-sky px-2 py-0.5 text-[11px] font-medium text-brand-blue" title={formatDateTime(r.createdAt)}>Ditambahkan kemudian</span>}
              </span>
              <a href={href(orderNumber, r.id)} className="inline-flex shrink-0 rounded-lg p-1.5 text-teal hover:bg-teal/10" aria-label={`Unduh ${r.fileName}`} title="Unduh">
                <Download className="size-4" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {!closed && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[13px] font-medium text-ink">Tambah berkas referensi</p>
          <p className="mt-0.5 text-[12px] text-ink-3">{ALLOWED_EXTENSIONS_LABEL} · maks. {COLLAB_LIMITS.referenceMaxFiles} berkas, total 4 MB per unggahan.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={input}
              data-testid="reference-input"
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => { setPicked(Array.from(e.target.files ?? [])); setError(null); }}
            />
            <Button size="sm" variant="secondary" icon={<Paperclip className="size-4" aria-hidden="true" />} onClick={() => input.current?.click()} disabled={busy}>Pilih berkas</Button>
            {picked.length > 0 && <span className="text-[12.5px] text-ink-2">{picked.map((f) => f.name).join(", ")}</span>}
            <Button size="sm" icon={<Upload className="size-4" aria-hidden="true" />} onClick={() => void upload()} loading={busy} disabled={picked.length === 0} data-testid="reference-upload">Unggah</Button>
          </div>
          {error && <p role="alert" data-testid="reference-error" className="mt-2 text-[12.5px] text-bad">{error}</p>}
        </div>
      )}
    </section>
  );
}
