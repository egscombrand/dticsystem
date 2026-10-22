"use client";

import { AlertTriangle, ExternalLink, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ApiError, internalRequest } from "@/lib/client/api";
import type { StatusTone } from "@/lib/status";

export type DriveArchiveFileView = {
  id: string;
  fileName: string;
  reconcileStatus: "missing" | "moved_out" | null;
  driveFolderId: string | null;
};

export type DriveArchiveLogView = {
  attemptedAtLabel: string;
  status: "success" | "partial" | "failed";
  message: string;
  errorDetail: string | null;
  triggeredByLabel: string;
};

export type DriveArchiveStatusView = {
  lastSyncAtLabel: string | null;
  lastSyncStatus: "success" | "partial" | "failed" | null;
  lastSyncMessage: string | null;
  consecutiveFailCount: number;
  escalationThreshold: number;
  escalatedAtLabel: string | null;
  log: DriveArchiveLogView[];
  files: DriveArchiveFileView[];
};

const STATUS_LABEL: Record<"success" | "partial" | "failed", { label: string; tone: StatusTone }> = {
  success: { label: "Tersinkron", tone: "success" },
  partial: { label: "Sebagian bermasalah", tone: "warning" },
  failed: { label: "Gagal", tone: "danger" },
};

const RECONCILE_FILE_LABEL: Record<"missing" | "moved_out", { label: string; tone: StatusTone }> = {
  missing: { label: "Tidak ditemukan di Drive", tone: "danger" },
  moved_out: { label: "Berpindah folder (tercatat ulang)", tone: "warning" },
};

/**
 * Status rekonsiliasi arsip Drive untuk SATU order (beda dari status sinkronisasi UNGGAHAN per file di
 * ResultFiles) — tidak pernah tampil bila order ini tidak pernah memakai Drive (lastSyncStatus null dan
 * tidak ada file berbasis Drive), supaya order lama/non-Drive tidak melihat kartu kosong.
 */
export function DriveArchiveStatus({ orderId, state }: { orderId: string; state: DriveArchiveStatusView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const usesDrive = state.lastSyncStatus !== null || state.files.some((f) => f.driveFolderId);
  if (!usesDrive) return null;

  async function retry() {
    setBusy(true);
    setError(null);
    setLastRun(null);
    try {
      const result = await internalRequest<{ skipped: boolean; reason?: string; status?: "success" | "partial" | "failed"; message?: string }>(
        `/api/internal/orders/${orderId}/drive-sync`,
        "POST",
        { force: true },
      );
      setLastRun(result.skipped ? (result.reason ?? "Dilewati.") : `${STATUS_LABEL[result.status!].label}: ${result.message}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rekonsiliasi belum berhasil dijalankan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  const escalated = state.consecutiveFailCount >= state.escalationThreshold;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[15px] font-medium text-ink">
          Arsip Google Drive
          {state.lastSyncStatus && <Badge tone={STATUS_LABEL[state.lastSyncStatus].tone} dot>{STATUS_LABEL[state.lastSyncStatus].label}</Badge>}
        </p>
        <button
          type="button"
          onClick={() => void retry()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:border-accent hover:text-accent disabled:opacity-60"
        >
          <RotateCcw className={busy ? "size-3.5 animate-spin motion-reduce:animate-none" : "size-3.5"} aria-hidden="true" />
          {busy ? "Memeriksa…" : "Coba Rekonsiliasi Lagi"}
        </button>
      </div>

      {state.lastSyncAtLabel && <p className="text-[13px] text-ink-2">Pemeriksaan terakhir: {state.lastSyncAtLabel}{state.lastSyncMessage ? ` — ${state.lastSyncMessage}` : ""}</p>}
      {error && <p role="alert" className="text-[13px] text-bad">{error}</p>}
      {lastRun && !error && <p className="text-[13px] text-ink-2">{lastRun}</p>}

      {escalated && (
        <p className="flex items-start gap-2 rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Rekonsiliasi gagal/sebagian {state.consecutiveFailCount}x berturut-turut.
          {state.escalatedAtLabel ? ` Peringatan sudah dikirim ke tim pada ${state.escalatedAtLabel}.` : ""} Mohon periksa manual.
        </p>
      )}
      {!escalated && state.consecutiveFailCount > 0 && (
        <p className="text-[13px] text-warn">Percobaan terakhir sebagian/gagal ({state.consecutiveFailCount}x berturut-turut).</p>
      )}

      {state.files.some((f) => f.reconcileStatus || f.driveFolderId) && (
        <ul className="flex flex-col gap-1.5">
          {state.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
              <span className="truncate" title={f.fileName}>{f.fileName}</span>
              {f.reconcileStatus && <Badge tone={RECONCILE_FILE_LABEL[f.reconcileStatus].tone}>{RECONCILE_FILE_LABEL[f.reconcileStatus].label}</Badge>}
              {f.driveFolderId && (
                <a
                  href={`https://drive.google.com/drive/folders/${f.driveFolderId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  Buka folder Drive <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {state.log.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium text-ink-2">Riwayat percobaan rekonsiliasi ({state.log.length})</summary>
          <ul className="mt-2 flex flex-col gap-2 border-l border-line pl-3">
            {state.log.map((entry, i) => (
              <li key={i}>
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_LABEL[entry.status].tone}>{STATUS_LABEL[entry.status].label}</Badge>
                  <span className="text-ink-2">{entry.attemptedAtLabel} · {entry.triggeredByLabel}</span>
                </p>
                <p className="text-ink-2">{entry.message}</p>
                {entry.errorDetail && <pre className="mt-1 whitespace-pre-wrap rounded bg-subtle px-2 py-1 text-[12px] text-bad">{entry.errorDetail}</pre>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
