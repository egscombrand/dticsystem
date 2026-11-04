"use client";

import {
  AlertTriangle, BadgeCheck, Check, ChevronLeft, ChevronRight, ClipboardList, Download, FileText, Highlighter, History, Layers, Link2,
  MessageCircleQuestion, MousePointer2, PlayCircle, RefreshCw, RotateCcw, Send, Square, Type, ZoomIn, ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageViewer, LinkViewer } from "@/components/review/document-viewers";
import type { DraftHighlight } from "@/components/review/highlight-layer";
import { PdfViewer } from "@/components/review/pdf-viewer";
import { fetchReviewState, newRequestKey, postReviewAction, type ReviewCtx } from "@/components/review/review-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, internalRequest } from "@/lib/client/api";
import { formatDateTime } from "@/lib/dates";
import {
  ANNOTATION_STATUS_LABEL, AUTHOR_KIND_LABEL, canSelectForRevision, documentUrl, formatAnnotationNumber, formatRevisionNumber,
  REVISION_STATUS_LABEL, type AnnotationStatus, type ReviewAnnotation, type ReviewRevision, type ReviewState, type ReviewVersion, type RevisionStatus,
} from "@/lib/review";
import type { StatusTone } from "@/lib/status";

const ANN_TONE: Record<AnnotationStatus, StatusTone> = {
  not_submitted: "warning", waiting_pic: "danger", waiting_clarification: "info", in_progress: "violet", waiting_check: "accent", done: "success",
};
const REV_TONE: Record<RevisionStatus, StatusTone> = {
  draft: "neutral", waiting_pic: "danger", in_progress: "violet", waiting_requester_check: "accent", approved: "success", resubmitted: "muted",
};
const VIEWER_LABEL: Record<ReviewState["viewer"], string> = { requester: "Pemohon", staff: "PIC", manager: "Manager (pemantau)", super_admin: "Super Admin" };

type Tab = "highlights" | "revisions" | "versions" | "history";
type PendingDraft = { draft: DraftHighlight } | { manual: true };

/**
 * Review Center: lihat hasil pekerjaan di DTIC Nexus, beri highlight + komentar, berdiskusi, ajukan Request Revisi
 * (REV-NNN), dan telusuri versi. BUKAN sistem QC: persetujuan akhir memakai keputusan pemohon yang sudah ada.
 */
export function ReviewCenter({ mode, orderRef, onOrderChanged }: { mode: "requester" | "internal"; orderRef: string; onOrderChanged?: () => void }) {
  const ctx = useMemo<ReviewCtx>(() => (mode === "requester" ? { mode, orderNumber: orderRef } : { mode, orderId: orderRef }), [mode, orderRef]);
  const [state, setState] = useState<ReviewState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [versionNo, setVersionNo] = useState<number | null>(null);
  const [docKey, setDocKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [goToPage, setGoToPage] = useState<{ page: number; nonce: number } | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [tool, setTool] = useState<"text" | "area">("text");
  const [pending, setPending] = useState<PendingDraft | null>(null);
  const [draftComment, setDraftComment] = useState("");
  const [manualRef, setManualRef] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("highlights");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [revisionDialog, setRevisionDialog] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [finalDialog, setFinalDialog] = useState(false);
  const [viewerErrors, setViewerErrors] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const next = await fetchReviewState(ctx);
      setState(next);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Review Center tidak dapat dimuat.");
    }
  }, [ctx]);

  useEffect(() => {
    const run = () => void refresh();
    run();
    const onFocus = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [refresh]);

  const versions = state?.versions ?? [];
  const version: ReviewVersion | undefined = versions.find((v) => v.versionNo === versionNo) ?? versions.at(-1);
  const docs = useMemo(
    () => (version ? [...version.files.map((f) => ({ key: `file:${f.id}`, label: f.fileName, file: f, link: null })), ...version.links.map((l) => ({ key: `link:${l.id}`, label: l.title, file: null, link: l }))] : []),
    [version],
  );
  const doc = docs.find((d) => d.key === docKey) ?? docs.find((d) => d.file && d.file.previewKind !== "none") ?? docs[0];
  const docAnnotations = useMemo(
    () => (state && version && doc ? state.annotations.filter((a) => a.deliveryId === version.deliveryId && (doc.file ? a.attachmentId === doc.file.id : a.linkId === doc.link!.id)) : []),
    [state, version, doc],
  );
  const perms = state?.permissions;
  const active = state?.annotations.find((a) => a.id === activeId) ?? null;

  const act = useCallback(
    async (body: Record<string, unknown>, opts: { notify?: boolean } = {}): Promise<ReviewState | null> => {
      setBusy(true);
      setActionError(null);
      try {
        const next = await postReviewAction(ctx, body);
        setState(next);
        if (opts.notify) onOrderChanged?.();
        return next;
      } catch (e) {
        setActionError(e instanceof ApiError || e instanceof Error ? e.message : "Tindakan gagal.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [ctx, onOrderChanged],
  );

  const onViewerError = useCallback((key: string, message: string) => setViewerErrors((e) => (e[key] === message ? e : { ...e, [key]: message })), []);

  function pickAnnotation(id: string) {
    const a = state?.annotations.find((x) => x.id === id);
    if (!a) return;
    setActiveId(id);
    setTab("highlights");
    if (version && a.deliveryId !== version.deliveryId) setVersionNo(a.versionNo);
    const key = a.attachmentId ? `file:${a.attachmentId}` : a.linkId ? `link:${a.linkId}` : null;
    if (key) setDocKey(key);
    if (a.page) setGoToPage({ page: a.page, nonce: Date.now() });
  }

  async function saveDraft() {
    if (!pending || !version || !doc) return;
    const base = { action: "annotate", deliveryId: version.deliveryId, attachmentId: doc.file?.id ?? null, linkId: doc.link?.id ?? null, comment: draftComment, requestKey: newRequestKey() };
    const body =
      "manual" in pending
        ? { ...base, kind: "manual", reference: manualRef, page: null }
        : { ...base, kind: pending.draft.kind, page: pending.draft.page, geometry: pending.draft.geometry, quote: pending.draft.quote };
    const before = new Set(state?.annotations.map((a) => a.id));
    const next = await act(body);
    if (next) {
      setPending(null);
      setDraftComment("");
      setManualRef("");
      const created = next.annotations.find((a) => !before.has(a.id));
      if (created) setActiveId(created.id);
      setTab("highlights");
    }
  }

  async function createRevision() {
    const next = await act({ action: "create_revision", annotationIds: [...selection], note: revisionNote, requestKey: newRequestKey() }, { notify: true });
    if (next) {
      setSelection(new Set());
      setRevisionNote("");
      setRevisionDialog(false);
      setTab("revisions");
    }
  }

  async function finalApprove() {
    const latest = versions.at(-1);
    if (!latest || mode !== "requester") return;
    setBusy(true);
    setActionError(null);
    try {
      await internalRequest("/api/public/tracking/decision", "POST", { orderNumber: orderRef, deliveryId: latest.deliveryId, decision: "approved", requestKey: newRequestKey() });
      setFinalDialog(false);
      await refresh();
      onOrderChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Persetujuan gagal.");
      setFinalDialog(false);
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !state) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad-soft p-4 text-sm text-bad">
        <span>{loadError}</span>
        <Button size="sm" variant="secondary" onClick={() => void refresh()}>Coba lagi</Button>
      </div>
    );
  }
  if (!state || !perms) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-ink-2" role="status">
        <Spinner className="size-4" /> Memuat Review Center…
      </div>
    );
  }
  if (versions.length === 0) {
    return (
      <div data-testid="review-center" className="rounded-xl border border-dashed border-line-strong p-5 text-sm text-ink-2">
        Belum ada hasil pekerjaan yang diserahkan kepada pemohon, jadi belum ada yang dapat direview. Review Center terbuka setelah PIC menyerahkan hasil.
      </div>
    );
  }

  const requester = state.viewer === "requester";
  const awaitingSelection = requester && perms.canRequestRevision;
  const openCount = state.revisions.filter((r) => r.status === "waiting_pic" || r.status === "in_progress" || r.status === "waiting_requester_check").length;
  const downloadUrl = doc?.file ? documentUrl(requester ? { mode: "requester", orderNumber: orderRef } : { mode: "internal" }, doc.file.id).replace("&inline=1", "").replace("?inline=1", "") : null;
  const src = doc?.file ? documentUrl(requester ? { mode: "requester", orderNumber: orderRef } : { mode: "internal" }, doc.file.id, { preview: doc.file.previewKind === "presentation" }) : null;
  const canReview = perms.canAnnotate && !!doc;
  const viewerError = doc ? viewerErrors[doc.key] : undefined;

  const toggleSelect = (a: ReviewAnnotation) => {
    setSelection((cur) => {
      const next = new Set(cur);
      if (next.has(a.id)) next.delete(a.id);
      else next.add(a.id);
      return next;
    });
  };

  return (
    <div data-testid="review-center" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-2">
          Anda masuk sebagai <strong className="text-ink">{VIEWER_LABEL[state.viewer]}</strong>
          {perms.readOnly ? " · hanya baca" : ""}
          {openCount > 0 ? ` · ${openCount} Request Revisi berjalan` : ""}
        </p>
        <Button size="sm" variant="secondary" onClick={() => void refresh()} icon={<RefreshCw className="size-3.5" aria-hidden="true" />}>Muat ulang</Button>
      </div>

      {actionError && <div role="alert" data-testid="rc-error" className="flex items-start gap-2 rounded-lg bg-bad-soft p-3 text-sm text-bad"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{actionError}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ---- Viewer ---- */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
              <Layers className="size-4" aria-hidden="true" />
              <span className="sr-only">Versi dokumen</span>
              <select data-testid="rc-version-select" value={version?.versionNo ?? ""} onChange={(e) => setVersionNo(Number(e.target.value))} className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink">
                {versions.map((v) => (
                  <option key={v.deliveryId} value={v.versionNo}>{`Versi ${v.versionNo}${v.isLatest ? " (terbaru)" : ""}`}</option>
                ))}
              </select>
            </label>
            {docs.length > 1 && (
              <select aria-label="Dokumen" data-testid="rc-doc-select" value={doc?.key ?? ""} onChange={(e) => setDocKey(e.target.value)} className="h-8 max-w-[220px] rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink">
                {docs.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            )}
            {doc?.file && doc.file.previewKind !== "none" && (
              <div className="flex items-center gap-1" role="group" aria-label="Zoom">
                <Button size="sm" variant="secondary" aria-label="Perkecil" data-testid="rc-zoom-out" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))} icon={<ZoomOut className="size-4" aria-hidden="true" />} />
                <span data-testid="rc-zoom-label" className="w-12 text-center text-[13px] tabular-nums text-ink-2">{Math.round(zoom * 100)}%</span>
                <Button size="sm" variant="secondary" aria-label="Perbesar" data-testid="rc-zoom-in" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))} icon={<ZoomIn className="size-4" aria-hidden="true" />} />
              </div>
            )}
            {doc?.file && (doc.file.previewKind === "pdf" || doc.file.previewKind === "presentation") && pageCount > 0 && !viewerError && (
              <div className="flex items-center gap-1" role="group" aria-label="Navigasi halaman">
                <Button size="sm" variant="secondary" aria-label="Halaman sebelumnya" disabled={currentPage <= 1} onClick={() => setGoToPage({ page: Math.max(1, currentPage - 1), nonce: Date.now() })} icon={<ChevronLeft className="size-4" aria-hidden="true" />} />
                <span data-testid="rc-page-label" className="min-w-16 text-center text-[13px] tabular-nums text-ink-2">{doc.file.previewKind === "presentation" ? "Slide" : "Hal."} {currentPage}/{pageCount}</span>
                <Button size="sm" variant="secondary" aria-label="Halaman berikutnya" disabled={currentPage >= pageCount} onClick={() => setGoToPage({ page: Math.min(pageCount, currentPage + 1), nonce: Date.now() })} icon={<ChevronRight className="size-4" aria-hidden="true" />} />
              </div>
            )}
            {downloadUrl && (
              <a href={downloadUrl} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-ink-2 hover:bg-subtle hover:text-ink" data-testid="rc-download">
                <Download className="size-4" aria-hidden="true" /> Unduh
              </a>
            )}
          </div>

          {perms.canAnnotate && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2">
              <Button size="sm" variant={reviewMode ? "primary" : "secondary"} aria-pressed={reviewMode} data-testid="rc-mode-toggle" onClick={() => setReviewMode((v) => !v)} icon={<Highlighter className="size-4" aria-hidden="true" />}>
                {reviewMode ? "Mode Review aktif" : "Aktifkan Mode Review"}
              </Button>
              {reviewMode && doc?.file && doc.file.previewKind !== "none" && (
                <div className="flex gap-1" role="group" aria-label="Alat highlight">
                  {doc.file.previewKind !== "image" && (
                    <Button size="sm" variant={tool === "text" ? "primary" : "secondary"} aria-pressed={tool === "text"} data-testid="rc-tool-text" onClick={() => setTool("text")} icon={<Type className="size-4" aria-hidden="true" />}>Pilih teks</Button>
                  )}
                  <Button size="sm" variant={tool === "area" || doc.file.previewKind === "image" ? "primary" : "secondary"} aria-pressed={tool === "area" || doc.file.previewKind === "image"} data-testid="rc-tool-area" onClick={() => setTool("area")} icon={<Square className="size-4" aria-hidden="true" />}>Area</Button>
                </div>
              )}
              {reviewMode && (
                <Button size="sm" variant="ghost" data-testid="rc-manual" onClick={() => setPending({ manual: true })} icon={<Link2 className="size-4" aria-hidden="true" />}>Referensi manual</Button>
              )}
              <p className="ml-auto text-[12px] text-ink-3">
                {reviewMode ? (doc?.file?.previewKind === "image" ? "Seret pada gambar untuk menandai area." : tool === "text" ? "Blok teks pada dokumen untuk membuat highlight." : "Seret pada halaman untuk menandai area.") : "Aktifkan Mode Review untuk membuat highlight."}
              </p>
            </div>
          )}

          {!doc ? null : doc.link ? (
            <LinkViewer title={doc.link.title} url={doc.link.url} />
          ) : viewerError || doc.file!.previewKind === "none" ? (
            <LoadFailure
              fileName={doc.file!.fileName}
              message={viewerError ?? "Format file ini tidak dapat dipratinjau di DTIC Nexus."}
              previewSrc={doc.file!.previewKind === "presentation" ? src : null}
              downloadUrl={downloadUrl}
              canManual={perms.canAnnotate}
              onManual={() => { setReviewMode(true); setPending({ manual: true }); }}
            />
          ) : doc.file!.previewKind === "image" ? (
            <ImageViewer
              key={doc.key}
              src={src!}
              alt={doc.file!.fileName}
              zoom={zoom}
              annotations={docAnnotations}
              activeAnnotationId={activeId}
              reviewMode={reviewMode}
              readOnly={!canReview}
              draft={pending && "draft" in pending ? pending.draft : null}
              onDraft={(d) => setPending({ draft: d })}
              onPick={pickAnnotation}
              onLoadError={(m) => onViewerError(doc.key, m)}
            />
          ) : (
            <PdfViewer
              key={doc.key}
              src={src!}
              zoom={zoom}
              annotations={docAnnotations}
              activeAnnotationId={activeId}
              reviewMode={reviewMode}
              tool={tool}
              readOnly={!canReview}
              draft={pending && "draft" in pending ? pending.draft : null}
              goToPage={goToPage}
              onDraft={(d) => setPending({ draft: d })}
              onPick={pickAnnotation}
              onPageCount={setPageCount}
              onCurrentPage={setCurrentPage}
              onLoadError={(m) => onViewerError(doc.key, m)}
            />
          )}

          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2" aria-label="Keterangan status highlight">
            {(Object.keys(ANNOTATION_STATUS_LABEL) as AnnotationStatus[]).map((s) => (
              <li key={s} className="inline-flex items-center gap-1.5"><Badge tone={ANN_TONE[s]} dot>{ANNOTATION_STATUS_LABEL[s]}</Badge></li>
            ))}
          </ul>
        </div>

        {/* ---- Panel samping ---- */}
        <div className="flex min-w-0 flex-col gap-3">
          {pending && (
            <div data-testid="rc-draft" className="rounded-xl border-2 border-accent/40 bg-accent-soft/40 p-3">
              <p className="text-[13px] font-semibold text-ink">Highlight baru</p>
              <p className="mt-0.5 text-[12.5px] text-ink-2" data-testid="rc-draft-info">
                {"manual" in pending ? "Referensi manual (tanpa posisi pada dokumen)" : pending.draft.kind === "text" ? `Teks pada halaman ${pending.draft.page}: “${pending.draft.quote}”` : `Area pada ${doc?.file?.previewKind === "image" ? "gambar" : `halaman ${pending.draft.page}`}`}
              </p>
              {"manual" in pending && (
                <>
                  <label htmlFor="rc-manual-ref" className="mt-2 block text-[12.5px] font-medium text-ink">Referensi (mis. “Slide 3, kalimat ‘Selamat datang’”)</label>
                  <input id="rc-manual-ref" data-testid="rc-manual-ref" value={manualRef} maxLength={300} onChange={(e) => setManualRef(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" />
                </>
              )}
              <label htmlFor="rc-draft-comment" className="mt-2 block text-[12.5px] font-medium text-ink">Komentar</label>
              <textarea id="rc-draft-comment" data-testid="rc-draft-comment" rows={3} maxLength={2000} value={draftComment} onChange={(e) => setDraftComment(e.target.value)} className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" placeholder="Apa yang perlu diperhatikan pada bagian ini?" />
              <div className="mt-2 flex gap-2">
                <Button size="sm" data-testid="rc-draft-save" loading={busy} disabled={!draftComment.trim() || ("manual" in pending && !manualRef.trim())} onClick={() => void saveDraft()}>Simpan highlight</Button>
                <Button size="sm" variant="ghost" data-testid="rc-draft-cancel" onClick={() => { setPending(null); setDraftComment(""); setManualRef(""); }}>Batal</Button>
              </div>
            </div>
          )}

          <div role="tablist" aria-label="Panel Review Center" className="flex gap-1 rounded-lg bg-subtle p-1">
            {([["highlights", `Highlight (${state.annotations.length})`, Highlighter], ["revisions", `Revisi (${state.revisions.length})`, ClipboardList], ["versions", "Versi", Layers], ["history", "Riwayat", History]] as const).map(([k, label, Icon]) => (
              <button key={k} role="tab" type="button" aria-selected={tab === k} data-testid={`rc-tab-${k}`} onClick={() => setTab(k)} className={cn("inline-flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[12px] font-medium", tab === k ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink")}>
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>

          {tab === "highlights" && (
            <HighlightsPanel
              state={state} activeId={activeId} selection={selection} selectable={awaitingSelection} onToggle={toggleSelect} onPick={pickAnnotation}
              active={active} perms={perms} busy={busy} act={act}
            />
          )}
          {tab === "revisions" && <RevisionsPanel state={state} perms={perms} busy={busy} act={act} onPick={pickAnnotation} requester={requester} />}
          {tab === "versions" && <VersionsPanel state={state} selected={version?.versionNo ?? 1} onSelect={(n) => { setVersionNo(n); setDocKey(null); }} />}
          {tab === "history" && <HistoryPanel state={state} />}

          {requester && (
            <div className="rounded-xl border border-line bg-surface p-3" data-testid="rc-actions-box">
              {awaitingSelection ? (
                <>
                  <p className="text-[13px] text-ink-2">Pilih highlight pada tab Highlight, lalu ajukan sebagai satu Request Revisi.</p>
                  <Button className="mt-2 w-full" size="sm" data-testid="rc-create-revision" disabled={selection.size === 0 || busy} onClick={() => setRevisionDialog(true)} icon={<ClipboardList className="size-4" aria-hidden="true" />}>
                    {selection.size > 0 ? `Ajukan Request Revisi (${selection.size} highlight)` : "Ajukan Request Revisi"}
                  </Button>
                </>
              ) : (
                !state.orderClosed && <p className="text-[13px] text-ink-2" data-testid="rc-no-revision-hint">Request Revisi baru dapat diajukan saat hasil terbaru menunggu keputusan Anda.</p>
              )}
              {perms.canFinalApprove && (
                <Button className="mt-2 w-full" size="sm" variant="secondary" data-testid="rc-final-approve" disabled={busy} onClick={() => setFinalDialog(true)} icon={<BadgeCheck className="size-4" aria-hidden="true" />}>
                  Setujui Hasil Akhir
                </Button>
              )}
              {perms.finalApprovalBlockedReason && (
                <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-warn" data-testid="rc-final-blocked"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{perms.finalApprovalBlockedReason}</p>
              )}
              {versions.at(-1)?.decision === "approved" && <p className="mt-2 text-[12.5px] text-ok" data-testid="rc-final-done">Hasil versi {versions.at(-1)!.versionNo} sudah Anda setujui.</p>}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={revisionDialog}
        onClose={() => setRevisionDialog(false)}
        title="Ajukan Request Revisi"
        description={`${selection.size} highlight akan dikirim ke PIC sebagai satu Request Revisi. Highlight lain tetap tersimpan dan belum diajukan.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevisionDialog(false)}>Batal</Button>
            <Button data-testid="rc-revision-confirm" loading={busy} onClick={() => void createRevision()}>Kirim Request Revisi</Button>
          </>
        }
      >
        <label htmlFor="rc-revision-note" className="block text-[13px] font-medium text-ink">Catatan tambahan <span className="font-normal text-ink-3">(opsional)</span></label>
        <textarea id="rc-revision-note" data-testid="rc-revision-note" rows={3} maxLength={600} value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" />
      </Modal>
      <Modal
        open={finalDialog}
        onClose={() => setFinalDialog(false)}
        title="Setujui hasil akhir?"
        description="Anda menyetujui hasil versi terbaru. Setelah ini PIC dapat menyelesaikan pekerjaan. Highlight yang belum diajukan tetap tersimpan."
        footer={
          <>
            <Button variant="secondary" onClick={() => setFinalDialog(false)}>Belum</Button>
            <Button data-testid="rc-final-confirm" loading={busy} onClick={() => void finalApprove()}>Ya, Setujui Hasil Akhir</Button>
          </>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------- panel Highlight + thread

function HighlightsPanel({
  state, activeId, selection, selectable, onToggle, onPick, active, perms, busy, act,
}: {
  state: ReviewState; activeId: string | null; selection: Set<string>; selectable: boolean; onToggle: (a: ReviewAnnotation) => void; onPick: (id: string) => void;
  active: ReviewAnnotation | null; perms: ReviewState["permissions"]; busy: boolean; act: (b: Record<string, unknown>) => Promise<ReviewState | null>;
}) {
  const [reply, setReply] = useState("");
  const [lastActive, setLastActive] = useState<string | null>(null);
  if (activeId !== lastActive) {
    setLastActive(activeId);
    setReply("");
  }
  async function send(kind: "comment" | "clarification_request") {
    if (!active || !reply.trim()) return;
    const next = await act({ action: "comment", annotationId: active.id, body: reply, kind, requestKey: newRequestKey() });
    if (next) setReply("");
  }
  if (state.annotations.length === 0) {
    return <p className="rounded-lg border border-dashed border-line-strong p-4 text-[13px] text-ink-2" data-testid="rc-empty-highlights">Belum ada highlight. Aktifkan Mode Review lalu blok teks atau tandai area pada dokumen.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex max-h-[300px] flex-col gap-1.5 overflow-auto pr-1" data-testid="rc-annotation-list">
        {state.annotations.map((a) => (
          <li key={a.id} data-testid={`rc-ann-item-${a.number}`} className={cn("flex items-start gap-2 rounded-lg border p-2 text-[13px]", activeId === a.id ? "border-accent bg-accent-soft/40" : "border-line bg-surface")}>
            {selectable && (
              <input type="checkbox" className="mt-1 size-4 accent-accent" data-testid={`rc-ann-check-${a.number}`} aria-label={`Pilih highlight ${formatAnnotationNumber(a.number)} untuk Request Revisi`} disabled={!canSelectForRevision(a)} checked={selection.has(a.id)} onChange={() => onToggle(a)} />
            )}
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onPick(a.id)}>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-ink">{formatAnnotationNumber(a.number)}</span>
                <span className="text-ink-3">v{a.versionNo}{a.page ? ` · hal. ${a.page}` : ""}</span>
                <Badge tone={ANN_TONE[a.status]} dot>{ANNOTATION_STATUS_LABEL[a.status]}</Badge>
                {a.revisionNumber !== null && <span className="text-[11.5px] text-ink-3">{formatRevisionNumber(a.revisionNumber)}</span>}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-ink-2">{a.quote ? `“${a.quote}”` : a.reference ?? a.comments[0]?.body}</span>
            </button>
          </li>
        ))}
      </ul>

      {active && (
        <div data-testid="rc-thread" className="rounded-xl border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-[13px] font-semibold text-ink">Percakapan {formatAnnotationNumber(active.number)}</p>
            <Badge tone={ANN_TONE[active.status]} dot>{ANNOTATION_STATUS_LABEL[active.status]}</Badge>
          </div>
          <ol className="mt-2 flex max-h-[260px] flex-col gap-2 overflow-auto" aria-label="Pesan">
            {active.comments.map((c) => (
              <li key={c.id} data-testid="rc-comment" className={cn("rounded-lg p-2 text-[13px]", c.authorKind === "requester" ? "bg-subtle" : "bg-accent-soft/50")}>
                <p className="text-[12px] text-ink-3">
                  <strong className="text-ink">{c.authorName}</strong> · {AUTHOR_KIND_LABEL[c.authorKind]} · {formatDateTime(c.at)}
                  {c.kind === "clarification_request" && <Badge tone="info" className="ml-1.5"><MessageCircleQuestion className="size-3" aria-hidden="true" />Minta klarifikasi</Badge>}
                  {c.kind === "clarification_answer" && <Badge tone="info" className="ml-1.5"><Check className="size-3" aria-hidden="true" />Jawaban klarifikasi</Badge>}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-ink">{c.body}</p>
              </li>
            ))}
          </ol>
          {perms.canComment && (
            <div className="mt-2">
              <label htmlFor="rc-reply" className="sr-only">Balasan</label>
              <textarea id="rc-reply" data-testid="rc-reply-body" rows={2} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" placeholder={active.status === "waiting_clarification" && state.viewer === "requester" ? "Jawab permintaan klarifikasi PIC…" : "Tulis balasan…"} />
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Button size="sm" data-testid="rc-reply-send" loading={busy} disabled={!reply.trim()} onClick={() => void send("comment")} icon={<Send className="size-3.5" aria-hidden="true" />}>
                  {active.status === "waiting_clarification" && state.viewer === "requester" ? "Kirim jawaban" : "Kirim balasan"}
                </Button>
                {perms.canClarify && (["not_submitted", "waiting_pic", "in_progress"] as AnnotationStatus[]).includes(active.status) && (
                  <Button size="sm" variant="secondary" data-testid="rc-clarify" disabled={busy || !reply.trim()} onClick={() => void send("clarification_request")} icon={<MessageCircleQuestion className="size-3.5" aria-hidden="true" />}>
                    Minta klarifikasi
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- panel Request Revisi

function RevisionsPanel({
  state, perms, busy, act, onPick, requester,
}: { state: ReviewState; perms: ReviewState["permissions"]; busy: boolean; act: (b: Record<string, unknown>, o?: { notify?: boolean }) => Promise<ReviewState | null>; onPick: (id: string) => void; requester: boolean }) {
  if (state.revisions.length === 0) return <p className="rounded-lg border border-dashed border-line-strong p-4 text-[13px] text-ink-2" data-testid="rc-empty-revisions">Belum ada Request Revisi.</p>;
  const byId = new Map(state.annotations.map((a) => [a.id, a]));
  return (
    <ol className="flex flex-col gap-2" data-testid="rc-revision-list">
      {[...state.revisions].reverse().map((r: ReviewRevision) => (
        <li key={r.id} data-testid={`rc-rev-${r.number}`} className="rounded-xl border border-line bg-surface p-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14px] font-semibold text-ink">{formatRevisionNumber(r.number)}</span>
            <Badge tone={REV_TONE[r.status]} dot>{REVISION_STATUS_LABEL[r.status]}</Badge>
            <span className="text-ink-3">ditinjau pada versi {r.reviewedVersionNo}{r.deliveredVersionNo ? ` → hasil versi ${r.deliveredVersionNo}` : ""}</span>
          </div>
          <p className="mt-1 text-ink-2">Diajukan {r.requestedByName} · {formatDateTime(r.at)}</p>
          {r.note && <p className="mt-1 whitespace-pre-wrap text-ink">{r.note}</p>}
          <p className="mt-1.5 flex flex-wrap gap-1">
            {r.annotationIds.map((id) => byId.get(id)).filter((a): a is ReviewAnnotation => !!a).map((a) => (
              <button key={a.id} type="button" onClick={() => onPick(a.id)} className="rounded-full bg-subtle px-2 py-0.5 text-[12px] font-medium text-ink-2 hover:text-ink">
                {formatAnnotationNumber(a.number)} · {ANNOTATION_STATUS_LABEL[a.status]}
              </button>
            ))}
          </p>
          {r.approvedAt && <p className="mt-1 text-ok">Disetujui {r.approvedByName} · {formatDateTime(r.approvedAt)}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {perms.canStartRevision && r.status === "waiting_pic" && (
              <Button size="sm" data-testid={`rc-rev-start-${r.number}`} loading={busy} onClick={() => void act({ action: "start_revision", revisionId: r.id })} icon={<PlayCircle className="size-4" aria-hidden="true" />}>Mulai kerjakan revisi</Button>
            )}
            {requester && perms.canApproveRevision && r.status === "waiting_requester_check" && (
              <>
                <Button size="sm" data-testid={`rc-rev-approve-${r.number}`} loading={busy} onClick={() => void act({ action: "approve_revision", revisionId: r.id }, { notify: true })} icon={<BadgeCheck className="size-4" aria-hidden="true" />}>Setujui Hasil Revisi</Button>
                <Button size="sm" variant="secondary" data-testid={`rc-rev-resubmit-${r.number}`} disabled={busy} onClick={() => void act({ action: "resubmit_revision", revisionId: r.id }, { notify: true })} icon={<RotateCcw className="size-4" aria-hidden="true" />}>Ajukan Revisi Kembali</Button>
              </>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- panel Versi & Riwayat

function VersionsPanel({ state, selected, onSelect }: { state: ReviewState; selected: number; onSelect: (n: number) => void }) {
  return (
    <ol className="flex flex-col gap-2" data-testid="rc-version-list">
      {[...state.versions].reverse().map((v) => {
        const related = state.revisions.filter((r) => r.reviewedVersionNo === v.versionNo || r.deliveredVersionNo === v.versionNo);
        const count = state.annotations.filter((a) => a.deliveryId === v.deliveryId).length;
        return (
          <li key={v.deliveryId} className={cn("rounded-xl border p-3 text-[13px]", selected === v.versionNo ? "border-accent bg-accent-soft/40" : "border-line bg-surface")}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[14px] font-semibold text-ink">Versi {v.versionNo}</span>
              {v.isLatest && <Badge tone="accent">Aktif</Badge>}
              <Badge tone={v.decision === "approved" ? "success" : v.decision === "revision_requested" ? "danger" : "warning"} dot>
                {v.decision === "approved" ? "Disetujui pemohon" : v.decision === "revision_requested" ? "Revisi diminta" : "Menunggu keputusan"}
              </Badge>
            </div>
            <p className="mt-1 text-ink-2">Diserahkan {formatDateTime(v.at)}{v.deliveredBy ? ` oleh ${v.deliveredBy}` : ""}</p>
            <p className="text-ink-2">{v.files.length} file, {v.links.length} tautan · {count} highlight pada versi ini</p>
            {related.length > 0 && (
              <p className="mt-1 text-ink-2">
                {related.map((r) => `${formatRevisionNumber(r.number)} (${r.reviewedVersionNo === v.versionNo ? "ditinjau di versi ini" : "hasil revisi"})`).join(" · ")}
              </p>
            )}
            <Button size="sm" variant={selected === v.versionNo ? "primary" : "secondary"} className="mt-2" data-testid={`rc-version-${v.versionNo}`} onClick={() => onSelect(v.versionNo)} icon={<FileText className="size-4" aria-hidden="true" />}>
              {selected === v.versionNo ? "Sedang dibuka" : "Buka versi ini"}
            </Button>
          </li>
        );
      })}
    </ol>
  );
}

function HistoryPanel({ state }: { state: ReviewState }) {
  const rows: { at: string; text: string }[] = [];
  for (const v of state.versions) rows.push({ at: v.at, text: `Hasil versi ${v.versionNo} diserahkan${v.deliveredBy ? ` (${v.deliveredBy})` : ""}` });
  for (const a of state.annotations) {
    rows.push({ at: a.at, text: `${a.createdByName} (${AUTHOR_KIND_LABEL[a.createdByKind]}) membuat highlight ${formatAnnotationNumber(a.number)} pada versi ${a.versionNo}` });
    for (const c of a.comments.slice(1)) rows.push({ at: c.at, text: `${c.authorName} (${AUTHOR_KIND_LABEL[c.authorKind]}) ${c.kind === "clarification_request" ? "meminta klarifikasi" : c.kind === "clarification_answer" ? "menjawab klarifikasi" : "membalas"} pada ${formatAnnotationNumber(a.number)}` });
  }
  for (const r of state.revisions) {
    rows.push({ at: r.at, text: `${r.requestedByName} mengajukan ${formatRevisionNumber(r.number)} (${r.annotationIds.length} highlight)` });
    if (r.startedAt) rows.push({ at: r.startedAt, text: `${formatRevisionNumber(r.number)} mulai dikerjakan` });
    if (r.deliveredVersionNo) {
      const v = state.versions.find((x) => x.versionNo === r.deliveredVersionNo);
      if (v) rows.push({ at: v.at, text: `Hasil ${formatRevisionNumber(r.number)} diserahkan (versi ${v.versionNo})` });
    }
    if (r.approvedAt) rows.push({ at: r.approvedAt, text: `${r.approvedByName} menyetujui ${formatRevisionNumber(r.number)}` });
    if (r.resubmittedAt) rows.push({ at: r.resubmittedAt, text: `${formatRevisionNumber(r.number)} diajukan kembali` });
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return (
    <ol className="flex max-h-[420px] flex-col gap-1.5 overflow-auto" data-testid="rc-history-list">
      {rows.map((r, i) => (
        <li key={i} className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
          <p className="text-ink">{r.text}</p>
          <p className="text-[12px] text-ink-3">{formatDateTime(r.at)}</p>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- gagal pratinjau

function LoadFailure({ fileName, message, previewSrc, downloadUrl, canManual, onManual }: { fileName: string; message: string; previewSrc: string | null; downloadUrl: string | null; canManual: boolean; onManual: () => void }) {
  const [detail, setDetail] = useState<string | null>(null);
  useEffect(() => {
    if (!previewSrc) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(previewSrc, { cache: "no-store" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (!cancelled && data.error) setDetail(data.error);
        }
      } catch {
        /* biarkan pesan umum */
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [previewSrc]);
  return (
    <div role="alert" data-testid="rc-load-failure" className="flex flex-col gap-3 rounded-xl border border-warn/30 bg-warn-soft p-4 text-sm text-ink">
      <p><strong>{fileName}</strong> tidak dapat dipratinjau.</p>
      <p className="text-ink-2">{detail ?? message}</p>
      <div className="flex flex-wrap gap-2">
        {downloadUrl && <a href={downloadUrl} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-subtle"><Download className="size-4" aria-hidden="true" /> Unduh file</a>}
        {canManual && <Button size="sm" variant="secondary" onClick={onManual} icon={<MousePointer2 className="size-4" aria-hidden="true" />}>Tulis referensi manual</Button>}
      </div>
    </div>
  );
}
