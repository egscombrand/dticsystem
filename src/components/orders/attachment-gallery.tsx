"use client";

import { Download, Eye, FileArchive, FileImage, FileSpreadsheet, FileText, ImageOff, Maximize2, Paperclip, Presentation } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { formatFileSize } from "@/lib/files";
import type { OrderAttachment } from "@/lib/types";

const PREVIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const isImage = (a: OrderAttachment) => a.mimeType === "image/png" || a.mimeType === "image/jpeg" || a.mimeType === "image/webp";

function typeLabel(a: OrderAttachment): string {
  if (a.mimeType === "application/pdf") return "PDF";
  if (isImage(a)) return a.mimeType.replace("image/", "").toUpperCase();
  const ext = a.fileName.split(".").pop();
  return ext && ext !== a.fileName ? ext.toUpperCase() : "File";
}

function TypeIcon({ a }: { a: OrderAttachment }) {
  const cls = "size-5 shrink-0";
  if (isImage(a)) return <FileImage className={`${cls} text-brand-violet`} aria-hidden="true" />;
  if (/sheet|excel|csv/.test(a.mimeType)) return <FileSpreadsheet className={`${cls} text-brand-emerald`} aria-hidden="true" />;
  if (/presentation|powerpoint/.test(a.mimeType)) return <Presentation className={`${cls} text-[#f59e0b]`} aria-hidden="true" />;
  if (/zip|compressed/.test(a.mimeType)) return <FileArchive className={`${cls} text-ink-3`} aria-hidden="true" />;
  return <FileText className={`${cls} text-brand-blue`} aria-hidden="true" />;
}

/**
 * Dokumen pendukung untuk PIC: gambar tampil sebagai thumbnail, berkas lain sebagai daftar dengan ikon jenis.
 * Semua tautan memakai endpoint lampiran internal yang sudah memeriksa sesi dan izin akses.
 */
export function AttachmentGallery({ attachments }: { attachments: OrderAttachment[] }) {
  const [zoom, setZoom] = useState<OrderAttachment | null>(null);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const markFailed = (id: string) => setFailed((prev) => new Set(prev).add(id));
  if (attachments.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-subtle px-4 py-3 text-sm text-ink-3">
        <Paperclip className="size-4" aria-hidden="true" /> Pemohon tidak melampirkan dokumen.
      </p>
    );
  }
  const images = attachments.filter(isImage);
  const others = attachments.filter((a) => !isImage(a));
  return (
    <div className="flex flex-col gap-4">
      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Gambar referensi">
          {images.map((a) => (
            <li key={a.id} className="group overflow-hidden rounded-xl border border-line bg-surface">
              {failed.has(a.id) ? (
                <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 bg-subtle text-sm text-ink-3" role="img" aria-label={`Pratinjau ${a.fileName} gagal dimuat`}>
                  <ImageOff className="size-6" aria-hidden="true" /> Pratinjau gagal dimuat
                </div>
              ) : (
                <button type="button" onClick={() => setZoom(a)} className="relative block w-full bg-subtle" aria-label={`Perbesar ${a.fileName}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- lampiran privat dari endpoint berautentikasi, bukan aset publik untuk optimizer */}
                  <img
                    src={`/api/internal/attachments/${a.id}?inline=1`}
                    alt={`Pratinjau ${a.fileName}`}
                    loading="lazy"
                    onError={() => markFailed(a.id)}
                    className="aspect-[4/3] w-full object-cover transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transition-none"
                  />
                  <span className="absolute right-2 bottom-2 rounded-md bg-black/55 p-1 text-white" aria-hidden="true"><Maximize2 className="size-3.5" /></span>
                </button>
              )}
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink" title={a.fileName}>{a.fileName}</p>
                  <p className="text-xs text-ink-3">{typeLabel(a)} · {formatFileSize(a.fileSize)}</p>
                </div>
                <a href={`/api/internal/attachments/${a.id}`} className="rounded-lg p-1.5 text-accent hover:bg-accent-soft" aria-label={`Unduh ${a.fileName}`}>
                  <Download className="size-4" aria-hidden="true" />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal open={zoom !== null} onClose={() => setZoom(null)} title={zoom?.fileName ?? ""} description={zoom ? `${typeLabel(zoom)} · ${formatFileSize(zoom.fileSize)}` : undefined}
        footer={zoom ? <a href={`/api/internal/attachments/${zoom.id}`} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-accent-soft"><Download className="size-4" aria-hidden="true" /> Unduh</a> : undefined}>
        {zoom && (
          // eslint-disable-next-line @next/next/no-img-element -- lampiran privat dari endpoint berautentikasi
          <img src={`/api/internal/attachments/${zoom.id}?inline=1`} alt={zoom.fileName} className="max-h-[70vh] w-full rounded-lg object-contain" onError={() => { markFailed(zoom.id); setZoom(null); }} />
        )}
      </Modal>
      {others.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Berkas lain">
          {others.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
              <TypeIcon a={a} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={a.fileName}>{a.fileName}</p>
                <p className="text-xs text-ink-3">{typeLabel(a)} · {formatFileSize(a.fileSize)}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                {PREVIEWABLE.has(a.mimeType) && (
                  <a href={`/api/internal/attachments/${a.id}?inline=1`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-subtle hover:text-ink" aria-label={`Lihat ${a.fileName}`}>
                    <Eye className="size-4" aria-hidden="true" /> <span className="hidden sm:inline">Lihat</span>
                  </a>
                )}
                <a href={`/api/internal/attachments/${a.id}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft" aria-label={`Unduh ${a.fileName}`}>
                  <Download className="size-4" aria-hidden="true" /> <span className="hidden sm:inline">Unduh</span>
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
