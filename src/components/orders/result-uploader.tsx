"use client";

import { FileUp, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";
import { cn } from "@/components/ui/cn";
import { checkResultFileBasics, formatFileSize, getExtension, PREVIEWABLE_MIME, RESULT_ACCEPT_ATTRIBUTE, RESULT_EXTENSIONS_LABEL, RESULT_FILE_TYPES, RESULT_MAX_FILES_PER_HANDOVER } from "@/lib/files";

export type UploadedResult = { id: string; fileName: string; mimeType: string; fileSize: number; driveSyncStatus?: "synced" | null };

type Item = {
  key: string; // uploadKey: dipakai ulang saat mencoba lagi agar server tidak menyimpan file ganda
  file: File;
  progress: number;
  state: "uploading" | "done" | "error";
  error?: string;
  result?: UploadedResult;
  previewUrl?: string;
};

/**
 * Unggah file hasil langsung ke DTIC Nexus (penyimpanan privat yang sama dengan lampiran).
 * Setiap file diunggah satu per permintaan dengan progres; gagal → dapat dicoba lagi dengan kunci yang sama.
 * File yang diunggah berstatus draf sampai aksi (Ajukan QC / Catat Pengiriman / Selesaikan) dikonfirmasi.
 */
export function ResultUploader({ orderId, maxBytes, onChange, disabled }: { orderId: string; maxBytes: number; onChange: (ids: UploadedResult[], busy: boolean) => void; disabled?: boolean }) {
  const inputId = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef<Item[]>([]);

  function commit(next: Item[]) {
    itemsRef.current = next;
    setItems(next);
    onChange(next.filter((i) => i.state === "done" && i.result).map((i) => i.result!), next.some((i) => i.state === "uploading"));
  }
  const patch = (key: string, p: Partial<Item>) => commit(itemsRef.current.map((i) => (i.key === key ? { ...i, ...p } : i)));

  function upload(item: Item) {
    const fd = new FormData();
    fd.set("uploadKey", item.key);
    fd.set("file", item.file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/internal/orders/${orderId}/results`);
    xhr.setRequestHeader("X-DTIC-Request", "1");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) patch(item.key, { progress: Math.round((e.loaded / e.total) * 100) }); };
    xhr.onload = () => {
      let data: { file?: UploadedResult; error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && data.file) patch(item.key, { state: "done", progress: 100, result: data.file });
      else patch(item.key, { state: "error", error: data.error ?? (xhr.status === 413 ? "File terlalu besar untuk diunggah." : `Unggahan gagal (HTTP ${xhr.status}).`) });
    };
    xhr.onerror = () => patch(item.key, { state: "error", error: "Koneksi terputus. Coba lagi; file tidak akan tergandakan." });
    xhr.send(fd);
  }

  function add(files: FileList | File[]) {
    setNotice(null);
    const list = Array.from(files);
    const room = RESULT_MAX_FILES_PER_HANDOVER - itemsRef.current.length;
    if (list.length > room) setNotice(`Maksimal ${RESULT_MAX_FILES_PER_HANDOVER} file per penyerahan.`);
    const fresh: Item[] = [];
    for (const file of list.slice(0, Math.max(0, room))) {
      const problem = checkResultFileBasics(file, maxBytes);
      const mime = RESULT_FILE_TYPES[getExtension(file.name)] ?? file.type;
      const item: Item = {
        key: crypto.randomUUID(),
        file,
        progress: 0,
        state: problem ? "error" : "uploading",
        error: problem ?? undefined,
        previewUrl: !problem && mime.startsWith("image/") && PREVIEWABLE_MIME.has(mime) ? URL.createObjectURL(file) : undefined,
      };
      fresh.push(item);
    }
    commit([...itemsRef.current, ...fresh]);
    for (const i of fresh) if (i.state === "uploading") upload(i);
  }

  async function remove(item: Item) {
    if (item.result) {
      // File draf di server dihapus juga (belum dirujuk pengajuan apa pun).
      await fetch(`/api/internal/orders/${orderId}/results/${item.result.id}`, { method: "DELETE", headers: { "X-DTIC-Request": "1" } }).catch(() => {});
    }
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    commit(itemsRef.current.filter((i) => i.key !== item.key));
  }

  function retry(item: Item) {
    if (checkResultFileBasics(item.file, maxBytes)) return;
    patch(item.key, { state: "uploading", progress: 0, error: undefined });
    upload({ ...item, state: "uploading" });
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (!disabled && e.dataTransfer.files.length) add(e.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="result-uploader">
      <label
        htmlFor={inputId}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors", drag ? "border-accent bg-accent-soft" : "border-line-strong hover:border-accent", disabled && "pointer-events-none opacity-60")}
      >
        <FileUp className="size-6 text-accent" aria-hidden="true" />
        <span className="text-sm font-medium text-ink">Pilih file hasil atau seret ke sini</span>
        <span className="text-[13px] text-ink-2">{RESULT_EXTENSIONS_LABEL} · maks. {formatFileSize(maxBytes)} per file</span>
        <input id={inputId} type="file" multiple accept={RESULT_ACCEPT_ATTRIBUTE} className="sr-only" disabled={disabled} aria-label="Unggah file hasil" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
      </label>
      {notice && <p className="text-[13px] text-warn">{notice}</p>}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="File hasil yang diunggah">
          {items.map((i) => (
            <li key={i.key} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2", i.state === "error" ? "border-[#fbd5d1] bg-bad-soft" : "border-line")}>
              {i.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- pratinjau lokal (object URL) sebelum diunggah
                <img src={i.previewUrl} alt="" className="size-10 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded bg-subtle text-[11px] font-semibold text-ink-2">{getExtension(i.file.name).toUpperCase() || "FILE"}</span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={i.file.name}>{i.file.name}</p>
                <p className="text-xs text-ink-2">
                  {formatFileSize(i.file.size)} · {i.state === "uploading" ? `Mengunggah ${i.progress}%` : i.state === "done" ? (i.result?.driveSyncStatus === "synced" ? "Tersimpan di Google Drive" : "Terunggah (draf)") : i.error}
                </p>
                {i.state === "uploading" && (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={i.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Progres ${i.file.name}`}>
                    <div className="h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none" style={{ width: `${i.progress}%` }} />
                  </div>
                )}
              </div>
              {i.state === "uploading" && <Loader2 className="size-4 shrink-0 animate-spin text-ink-3 motion-reduce:animate-none" aria-hidden="true" />}
              {i.state === "error" && !checkResultFileBasics(i.file, maxBytes) && (
                <button type="button" onClick={() => retry(i)} className="rounded-md p-1.5 text-ink-2 hover:bg-surface" aria-label={`Coba unggah ulang ${i.file.name}`}><RotateCcw className="size-4" /></button>
              )}
              {i.state !== "uploading" && (
                <button type="button" onClick={() => void remove(i)} className="rounded-md p-1.5 text-ink-2 hover:bg-surface hover:text-bad" aria-label={`Hapus ${i.file.name}`}>
                  {i.state === "done" ? <Trash2 className="size-4" /> : <X className="size-4" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
