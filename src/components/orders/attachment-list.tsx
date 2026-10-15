import { Download, Eye, FileText, Paperclip } from "lucide-react";
import { formatFileSize } from "@/lib/files";
import type { OrderAttachment } from "@/lib/types";

const PREVIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

export function AttachmentList({ attachments }: { attachments: OrderAttachment[] }) {
  if (attachments.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-3">
        <Paperclip className="size-4" aria-hidden="true" /> Tidak ada dokumen pendukung.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {attachments.map((a) => (
        <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
          <FileText className="size-5 shrink-0 text-ink-3" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink" title={a.fileName}>{a.fileName}</p>
            <p className="text-xs text-ink-3">{formatFileSize(a.fileSize)}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            {PREVIEWABLE.has(a.mimeType) && (
              <a
                href={`/api/internal/attachments/${a.id}?inline=1`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-subtle hover:text-ink"
                aria-label={`Lihat ${a.fileName}`}
              >
                <Eye className="size-4" aria-hidden="true" /> <span className="hidden sm:inline">Lihat</span>
              </a>
            )}
            <a
              href={`/api/internal/attachments/${a.id}`}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft"
              aria-label={`Unduh ${a.fileName}`}
            >
              <Download className="size-4" aria-hidden="true" /> <span className="hidden sm:inline">Unduh</span>
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}
