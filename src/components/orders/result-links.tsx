"use client";

import { ExternalLink, Link2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, internalRequest } from "@/lib/client/api";

export type ResultLinkView = { id: string; url: string; title: string; description: string | null; createdByName: string | null; used: boolean; canDelete: boolean };

/** Daftar link hasil (website/repo/hosting) — pelengkap file untuk pekerjaan yang hasilnya bukan dokumen. */
export function ResultLinks({ orderId, links }: { orderId: string; links: ResultLinkView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(l: ResultLinkView) {
    if (!window.confirm(`Hapus link "${l.title}"?`)) return;
    setBusy(l.id);
    setError(null);
    try {
      await internalRequest(`/api/internal/orders/${orderId}/result-links/${l.id}`, "DELETE");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Link belum terhapus. Coba lagi.");
    } finally {
      setBusy(null);
    }
  }

  if (links.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Link hasil pekerjaan">
        {links.map((l) => (
          <li key={l.id} className="flex items-start gap-3 px-4 py-3">
            <Link2 className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                {l.title} <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
              {l.description && <p className="mt-0.5 text-sm text-ink-2">{l.description}</p>}
              <p className="mt-0.5 truncate text-xs text-ink-3" title={l.url}>{l.url}</p>
              {l.createdByName && <p className="mt-0.5 text-xs text-ink-3">Ditambahkan oleh {l.createdByName}</p>}
            </div>
            {l.canDelete && !l.used && (
              <button type="button" onClick={() => remove(l)} disabled={busy === l.id} className="shrink-0 rounded-lg p-1.5 text-ink-3 hover:bg-subtle hover:text-bad disabled:opacity-50" aria-label={`Hapus link ${l.title}`}>
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
