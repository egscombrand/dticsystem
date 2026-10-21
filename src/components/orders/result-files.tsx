"use client";

import { AlertTriangle, Download, Eye, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ApiError, internalRequest } from "@/lib/client/api";
import { DRIVE_SYNC_LABEL, type DriveSyncStatus } from "@/lib/drive";
import { formatFileSize, getExtension, PREVIEWABLE_MIME } from "@/lib/files";
import type { StatusTone } from "@/lib/status";

export type ResultFileView = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploaderName: string | null;
  uploadedAtLabel: string;
  stageLabel: string;
  stageTone: StatusTone;
  trail: { label: string; atLabel: string }[];
  canDelete: boolean;
  /** null = tersimpan di storage lokal/Supabase (tidak memakai Drive; selalu tersedia seperti sebelumnya). */
  driveSyncStatus: DriveSyncStatus | null;
  driveSyncError: string | null;
};

const DRIVE_TONE: Record<DriveSyncStatus, StatusTone> = { pending: "warning", synced: "info", failed: "danger" };

/** Daftar file hasil (output PIC), terpisah dari dokumen referensi pemohon. Akses file lewat endpoint berautentikasi. */
export function ResultFiles({ orderId, files }: { orderId: string; files: ResultFileView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(f: ResultFileView) {
    if (!window.confirm(`Hapus draf "${f.fileName}"?`)) return;
    setBusy(f.id);
    setError(null);
    try {
      await internalRequest(`/api/internal/orders/${orderId}/results/${f.id}`, "DELETE");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "File belum terhapus. Coba lagi.");
    } finally {
      setBusy(null);
    }
  }

  async function retry(f: ResultFileView, picked: File) {
    setBusy(f.id);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", picked);
      const res = await fetch(`/api/internal/orders/${orderId}/results/${f.id}/retry`, { method: "POST", headers: { "X-DTIC-Request": "1" }, body: fd });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Gagal mengunggah ulang (HTTP ${res.status}).`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Belum berhasil disinkronkan ulang. Coba lagi.");
    } finally {
      setBusy(null);
    }
  }

  if (files.length === 0) return <p className="text-[15px] text-ink-2">Belum ada file hasil yang diunggah. Unggah file saat menekan Ajukan QC.</p>;
  return (
    <div className="flex flex-col gap-2">
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <ul className="divide-y divide-line rounded-xl border border-line" aria-label="File hasil pekerjaan">
        {files.map((f) => {
          const ready = f.driveSyncStatus === null || f.driveSyncStatus === "synced";
          const inputId = `retry-${f.id}`;
          return (
            <li key={f.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[11px] font-semibold text-accent" aria-hidden="true">{getExtension(f.fileName).toUpperCase() || "FILE"}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[15px] font-medium text-ink" title={f.fileName}>{f.fileName}</span>
                  <Badge tone={f.stageTone} dot>{f.stageLabel}</Badge>
                  {f.driveSyncStatus && (
                    <Badge tone={DRIVE_TONE[f.driveSyncStatus]} dot>
                      {f.driveSyncStatus === "pending" && <Loader2 className="mr-1 inline size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                      {DRIVE_SYNC_LABEL[f.driveSyncStatus]}
                    </Badge>
                  )}
                </p>
                <p className="text-[13px] text-ink-2">{formatFileSize(f.fileSize)} · diunggah {f.uploaderName ?? "PIC"} · {f.uploadedAtLabel}</p>
                {f.driveSyncStatus === "failed" && f.driveSyncError && (
                  <p className="mt-1 flex items-start gap-1.5 text-[13px] text-bad"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {f.driveSyncError}</p>
                )}
                {f.trail.length > 0 && (
                  <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-2" aria-label={`Riwayat ${f.fileName}`}>
                    {f.trail.map((t, i) => <li key={i}>{t.label} · {t.atLabel}</li>)}
                  </ol>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                {ready && PREVIEWABLE_MIME.has(f.mimeType) && (
                  <a href={`/api/internal/attachments/${f.id}?inline=1`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-subtle hover:text-ink" aria-label={`Lihat ${f.fileName}`}>
                    <Eye className="size-4" aria-hidden="true" /> Lihat
                  </a>
                )}
                {ready && (
                  <a href={`/api/internal/attachments/${f.id}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft" aria-label={`Unduh ${f.fileName}`}>
                    <Download className="size-4" aria-hidden="true" /> Unduh
                  </a>
                )}
                {f.driveSyncStatus === "failed" && (
                  <>
                    <label htmlFor={inputId} className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft aria-disabled:pointer-events-none aria-disabled:opacity-50" aria-disabled={busy === f.id}>
                      {busy === f.id ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />} Coba Lagi
                    </label>
                    <input
                      id={inputId}
                      type="file"
                      className="sr-only"
                      disabled={busy === f.id}
                      onChange={(e) => { const picked = e.target.files?.[0]; if (picked) void retry(f, picked); e.target.value = ""; }}
                      aria-label={`Pilih file untuk mencoba lagi mengunggah ${f.fileName} ke Google Drive`}
                    />
                  </>
                )}
                {f.canDelete && (
                  <button type="button" disabled={busy === f.id} onClick={() => void remove(f)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-bad-soft hover:text-bad disabled:opacity-50" aria-label={`Hapus draf ${f.fileName}`}>
                    <Trash2 className="size-4" aria-hidden="true" /> Hapus
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {files.some((f) => (f.driveSyncStatus === null || f.driveSyncStatus === "synced") && !PREVIEWABLE_MIME.has(f.mimeType)) && (
        <p className="text-[13px] text-ink-2">Pratinjau tersedia untuk gambar (JPG, PNG, WEBP) dan PDF. Format lain (mis. PSD, AI, SVG, ZIP) dapat diunduh.</p>
      )}
    </div>
  );
}
