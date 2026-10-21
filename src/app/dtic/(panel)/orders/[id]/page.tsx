import { canAccessOrder, requireSession } from "@/lib/server/auth";
import { can } from "@/lib/auth/permissions";
import { CalendarClock, ExternalLink, FileCheck2, KeyRound, FileText, ListChecks, Paperclip, Pencil, Send, ShieldCheck, Undo2, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AssignmentField } from "@/components/assignments/assignment-field";
import { ActivityTimeline } from "@/components/orders/activity-timeline";
import { AttachmentGallery } from "@/components/orders/attachment-gallery";
import { DeadlineChangeButton } from "@/components/orders/deadline-change";
import { DeleteOrderButton } from "@/components/orders/delete-order-button";
import { NotesEditor } from "@/components/orders/notes-editor";
import { QcFlowActions } from "@/components/orders/qc-flow-actions";
import { WhatsappMessageButton } from "@/components/orders/whatsapp-message";
import type { WaContext } from "@/lib/smart-whatsapp";
import { ResultFiles, type ResultFileView } from "@/components/orders/result-files";
import { latestResultIds, latestResultLinkIds, resultFileHistory, resultLinksUsed, RESULT_STAGE_LABEL, type ResultStage } from "@/lib/result-status";
import { listResultFiles, listResultLinks } from "@/lib/server/repositories/results";
import { ResultLinks, type ResultLinkView } from "@/components/orders/result-links";
import { syncOrderDriveMetadata } from "@/lib/server/repositories/drive-sync";
import { WorkStepper } from "@/components/orders/work-stepper";
import { deriveWorkStage } from "@/lib/work-stage";
import { resultMaxFileBytes } from "@/lib/server/config";
import { StatusChanger } from "@/components/orders/status-changer";
import { RichTextView } from "@/components/rich-text/rich-text-view";
import { Badge, OverdueBadge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { OrderDetailSkeleton } from "@/components/ui/skeletons";
import { describeDeadline, formatDateTime, formatDeadline } from "@/lib/dates";
import { availableWorkflowActions, completionNeedsNote, DELIVERY_STATUS_LABEL, HANDOVER_CHANNEL_LABEL, QC_STATUS_LABEL, type HandoverChannel, type DeliveryStatus, type QcStatus } from "@/lib/qc";
import { UUID_RE } from "@/lib/server/http";
import { listTeamMemberOptions } from "@/lib/server/repositories/master-data";
import { getOrderDetail, listOrderActivity } from "@/lib/server/repositories/orders";
import { deliveryStatusOf, getQcStatus, hasContactedRequester, listActiveManagerNames, listWorkflowEvents } from "@/lib/server/repositories/qc";
import { getMemberWorkloads } from "@/lib/server/repositories/workload";
import { isFinishedStatus, isOverdue, STATUS_META, type OrderStatus, type StatusTone } from "@/lib/status";
import { formatWhatsappDisplay } from "@/lib/whatsapp";
import { allowedTransitions } from "@/lib/workflow";

export const metadata: Metadata = { title: "Detail Pekerjaan" };

/** Satu instruksi per status. Tombol di bawahnya dihitung dari aturan server (status + hak akses). */
const NEXT_STEP: Record<OrderStatus, string> = {
  submitted: "Pekerjaan ini belum memiliki PIC. Manager atau Super Admin perlu menetapkan PIC lebih dulu.",
  assigned: "Pelajari brief dan bahan referensi, lalu mulai kerjakan.",
  in_progress: "Pelajari brief dan siapkan hasil sesuai spesifikasi. Setelah hasil siap, ajukan QC atau selesaikan pekerjaan.",
  pending_confirmation: "Pekerjaan sedang menunggu pemeriksaan Manager.",
  internal_revision: "Tinjau catatan Manager dan perbaiki hasil.",
  awaiting_requester: "Hasil sudah tercatat dikirim kepada pemohon. Catat masukan pemohon bila ada, atau selesaikan pekerjaan bila sudah disepakati.",
  on_hold: "Pekerjaan dihentikan sementara. Alasannya tercatat di riwayat aktivitas.",
  completed: "Pekerjaan telah diselesaikan.",
  cancelled: "Pekerjaan dibatalkan. Alasannya tercatat di riwayat aktivitas.",
};

const QC_TONE: Record<QcStatus, StatusTone> = { none: "muted", pending: "violet", approved: "success", revision: "danger" };
const DELIVERY_TONE: Record<DeliveryStatus, StatusTone> = { none: "muted", direct: "info", after_qc: "success" };

function Section({ title, icon, children, id, testId }: { title: string; icon: ReactNode; children: ReactNode; id?: string; testId?: string }) {
  return (
    <section id={id} data-testid={testId} className="scroll-mt-24 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">{icon}{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SideCard({ title, children, testId, className }: { title: string; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section data-testid={testId} className={cn("rounded-2xl border border-line bg-surface p-5 shadow-card", className)}>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function OrderDetailPage({ params }: PageProps<"/dtic/orders/[id]">) {
  return (
    <Suspense fallback={<OrderDetailSkeleton />}>
      <OrderDetailContent params={params} />
    </Suspense>
  );
}

async function OrderDetailContent({ params }: { params: PageProps<"/dtic/orders/[id]">["params"] }) {
  const { id } = await params;
  await connection();
  const session = await requireSession();
  if (!UUID_RE.test(id)) notFound();
  // Staff yang tidak ditugaskan menerima 404 (tidak mengungkap keberadaan order).
  if (!(await canAccessOrder(session, id))) notFound();
  const canEdit = can(session.role, "orders.update");
  const canDelete = can(session.role, "orders.delete");
  const canAssign = can(session.role, "orders.manage_pic");
  const viewAll = can(session.role, "orders.view_all");
  const order = await getOrderDetail(id);
  if (!order) notFound();
  // Sinkronisasi otomatis saat halaman dibuka (Fase 4) — DIBATASI oleh jendela dedupe di repository
  // (dilewati diam-diam bila < 2 menit lalu), jadi membuka halaman berulang tidak memicu panggilan Drive
  // berulang. Dijalankan SEBELUM listResultFiles di bawah agar file yang baru ditemukan langsung tampil.
  await syncOrderDriveMetadata(id);
  const [members, workloads, qcStatus, events, audit, managerNames, results, contacted, resultLinks] = await Promise.all([
    listTeamMemberOptions(order.teamId),
    canAssign && order.teamId ? getMemberWorkloads(order.teamId) : Promise.resolve([]),
    getQcStatus(order.id),
    listWorkflowEvents(order.id),
    // Perubahan PIC/deadline beserta alasannya hanya untuk role yang melihat seluruh order.
    viewAll ? listOrderActivity(order.id) : Promise.resolve([]),
    listActiveManagerNames(),
    listResultFiles(id),
    hasContactedRequester(id, session.userId),
    listResultLinks(id),
  ]);
  if (!qcStatus) notFound();

  const now = new Date();
  const late = isOverdue(order.deadlineAt, order.status, now);
  const finished = isFinishedStatus(order.status);
  const isAssignee = !!session.memberId && order.assignees.some((a) => a.id === session.memberId);
  const statusActions = allowedTransitions(order.status, { role: session.role, isAssignee });
  const ctx = { status: order.status, qcStatus };
  const actions = availableWorkflowActions(ctx, { role: session.role, isAssignee });
  const delivery = deliveryStatusOf(events);
  const fileIdsOf = (e: { detail: Record<string, unknown> }) => (Array.isArray(e.detail.resultFileIds) ? (e.detail.resultFileIds as string[]) : []);
  const lastResult = events.find((e) => (e.kind === "qc_submitted" || e.kind === "delivery_recorded" || e.kind === "completed") && (e.link || fileIdsOf(e).length > 0 || e.detail.method === "external"));
  const accessRequest = order.status === "in_progress" ? events.find((e) => e.kind !== "whatsapp_opened") : undefined;
  const revisionNote = order.status === "internal_revision" ? events.find((e) => e.kind === "qc_revision_requested") : undefined;
  const completion = order.status === "completed" ? events.find((e) => e.kind === "completed") : undefined;
  const resultHist = resultFileHistory(results.map((r) => r.id), events);
  const STAGE_TONE: Record<ResultStage, StatusTone> = { draft: "muted", submitted: "violet", approved: "success", delivered: "info" };
  const resultViews: ResultFileView[] = results.map((r) => {
    const h = resultHist[r.id];
    return {
      id: r.id, fileName: r.fileName, mimeType: r.mimeType, fileSize: r.fileSize, uploaderName: r.uploaderName,
      uploadedAtLabel: formatDateTime(r.uploadedAt),
      stageLabel: RESULT_STAGE_LABEL[h.stage], stageTone: STAGE_TONE[h.stage],
      trail: h.trail.map((t) => ({ label: t.label, atLabel: formatDateTime(t.at) })),
      canDelete: h.stage === "draft" && !h.usedInCompletion && !finished && (session.role === "super_admin" || r.uploadedBy === session.userId),
      driveSyncStatus: r.driveSyncStatus,
      driveSyncError: r.driveSyncError,
    };
  });
  const linkUsed = resultLinksUsed(resultLinks.map((l) => l.id), events);
  const resultLinkViews: ResultLinkView[] = resultLinks.map((l) => ({
    id: l.id, url: l.url, title: l.title, description: l.description, createdByName: l.createdByName,
    used: linkUsed[l.id] ?? false,
    canDelete: !finished && (session.role === "super_admin" || l.createdBy === session.userId),
  }));
  // Hanya file yang sudah benar-benar tersedia (bukan masih menunggu/gagal disinkronkan ke Drive) yang bisa dipilih untuk diserahkan.
  const existingResults = results
    .filter((r) => r.driveSyncStatus === null || r.driveSyncStatus === "synced")
    .map((r) => ({ id: r.id, fileName: r.fileName, fileSize: r.fileSize, statusLabel: RESULT_STAGE_LABEL[resultHist[r.id].stage] }));
  // Konteks Smart WhatsApp: hanya dari peristiwa yang benar-benar tercatat.
  const workEvents = events.filter((e) => e.kind !== "whatsapp_opened");
  const lastWork = workEvents[0];
  const lastRevision = workEvents.find((e) => e.kind === "feedback_recorded" && e.needsRevision);
  const shareable = workEvents.find((e) => (e.kind === "qc_approved" || e.kind === "delivery_recorded" || e.kind === "completed") && e.link);
  const holdEntry = order.history.find((h) => h.newStatus === "on_hold" && h.notes);
  const waContext: WaContext = {
    status: order.status,
    qcStatus,
    delivery,
    lastEventKind: lastWork?.kind ?? null,
    requesterRevision: lastRevision?.summary ?? null,
    revisionDelivered: Boolean(lastRevision && workEvents.some((e) => e.kind === "delivery_recorded" && e.at > lastRevision.at)),
    shareableLink: shareable?.link ?? null,
    resultFileCount: results.length,
    holdReason: order.status === "on_hold" ? (holdEntry?.notes ?? null) : null,
    firstContact: !contacted,
  };
  const WA_EVENT_LABEL: Record<string, string> = {
    qc_submitted: "Hasil diajukan ke Manager", qc_withdrawn: "Pengajuan QC ditarik", qc_approved: "Hasil disetujui Manager",
    qc_revision_requested: "Revisi internal diminta", qc_access_requested: "Manager meminta file/akses", delivery_recorded: "Pengiriman ke pemohon dicatat",
    feedback_recorded: "Masukan pemohon dicatat", completed: "Pekerjaan diselesaikan",
  };
  const waContextLabel = lastWork ? `${WA_EVENT_LABEL[lastWork.kind] ?? "Aktivitas"} · ${formatDateTime(lastWork.at)}` : `Belum ada aktivitas penyerahan · ${STATUS_META[order.status].label}`;
  const hasSize = Boolean(order.designSize) && order.designSize !== "Tidak ada ukuran (bukan pekerjaan desain)";
  const hasDescription = order.brief.trim().length > 0;
  const specs: [string, string][] = [
    ["Jenis pekerjaan", order.designType],
    ...(hasSize ? [["Ukuran / dimensi output", order.designSize] as [string, string]] : []),
    ...(order.briefYear ? [["Tahun", String(order.briefYear)] as [string, string]] : []),
  ];
  const hasEverRequestedRevision = events.some((e) => e.kind === "qc_revision_requested");
  const workStage = deriveWorkStage({ orderStatus: order.status, qcStatus, hasDraftResults: results.length > 0, hasEverRequestedRevision });

  return (
    <div className="flex flex-col gap-6">
      {/* Header: identitas & kondisi pekerjaan, satu kali saja. */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-[13px] text-ink-2">
            <Link href="/dtic/orders" className="hover:text-accent hover:underline">Pengelolaan Pekerjaan</Link> <span aria-hidden="true">/</span> <span>Detail Pekerjaan</span>
          </nav>
          <p className="mt-2 font-mono text-sm text-ink-2">{order.orderNumber}</p>
          <h1 className="mt-1 text-2xl leading-tight font-semibold break-words text-ink sm:text-[28px]">{order.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={order.status} />
            <PriorityBadge name={order.priorityName} tone={order.priorityTone} />
            {late && <OverdueBadge />}
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-ink-2">
            <div className="flex items-center gap-1.5">
              <CalendarClock className="size-4 text-ink-3" aria-hidden="true" />
              <dt className="sr-only">Deadline</dt>
              <dd>
                <span className="text-ink">{formatDeadline(order.deadlineAt)}</span>
                {!finished && <span className={late ? "font-medium text-bad" : ""}> · {describeDeadline(order.deadlineAt, now)}</span>}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <Users className="size-4 text-ink-3" aria-hidden="true" />
              <dt className="sr-only">PIC</dt>
              <dd className="text-ink">{order.assignees.length ? order.assignees.map((a) => a.name).join(", ") : "Belum ada PIC"}</dd>
            </div>
          </dl>
        </div>
        {(canEdit || canDelete) && (
          <div className="flex shrink-0 gap-2">
            {canEdit && <LinkButton href={`/dtic/orders/${order.id}/edit`} variant="secondary" icon={<Pencil className="size-4" />}>Edit detail</LinkButton>}
            {canDelete && <DeleteOrderButton orderId={order.id} orderNumber={order.orderNumber} />}
          </div>
        )}
      </header>

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
        <WorkStepper current={workStage} cancelled={order.status === "cancelled"} hasEverRequestedRevision={hasEverRequestedRevision} />
      </div>

      {/*
        Desktop: kolom utama (brief → bahan → penyerahan → riwayat) + panel samping (langkah berikutnya di atas).
        Mobile: langkah berikutnya tampil tepat di bawah header, lalu brief, lalu info sekunder.
      */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-[auto_1fr]">
        <aside className="flex min-w-0 flex-col gap-6 xl:col-start-2 xl:row-start-1">
          <SideCard title="Langkah berikutnya" testId="next-step" className="border-accent/30">
            <p className="text-[15px] leading-relaxed text-ink" data-testid="next-step-text">{NEXT_STEP[order.status]}</p>
            {completion && (
              <div className="mt-3 rounded-xl bg-ok-soft p-3 text-sm text-ink">
                <p>Diselesaikan {formatDateTime(completion.at)}{completion.actorName ? ` oleh ${completion.actorName}` : ""}.</p>
                {completion.summary && <p className="mt-1 whitespace-pre-wrap text-ink-2">{completion.summary}</p>}
              </div>
            )}
            {!completion && order.completedAt && <p className="mt-2 text-sm text-ink-2">Diselesaikan {formatDateTime(order.completedAt)}.</p>}
            {!finished && (
              <div className="mt-4 flex flex-col gap-3">
                <StatusChanger orderId={order.id} status={order.status} actions={statusActions.filter((t) => t.to !== "cancelled" && t.to !== "on_hold")} compact />
                {actions.length > 0 && (
                  <QcFlowActions
                    orderId={order.id}
                    orderTitle={order.title}
                    orderNumber={order.orderNumber}
                    actions={actions}
                    qcStatus={qcStatus}
                    requester={{ name: order.requesterName, whatsapp: order.requesterWhatsapp }}
                    managerNames={managerNames}
                    lastLink={lastResult?.link ?? null}
                    completionNeedsNote={completionNeedsNote(ctx)}
                    maxResultBytes={resultMaxFileBytes()}
                    existingResults={existingResults}
                    defaultResultIds={latestResultIds(events)}
                    resultLinks={resultLinks}
                    defaultResultLinkIds={latestResultLinkIds(events)}
                  />
                )}
                {statusActions.some((t) => t.to === "cancelled" || t.to === "on_hold") && (
                  <div className="border-t border-line pt-3">
                    <StatusChanger orderId={order.id} status={order.status} actions={statusActions.filter((t) => t.to === "cancelled" || t.to === "on_hold")} compact />
                  </div>
                )}
                {actions.length === 0 && statusActions.length === 0 && (
                  <p className="text-sm text-ink-2">Tidak ada tindakan yang dapat Anda lakukan pada tahap ini.</p>
                )}
              </div>
            )}
          </SideCard>

          <SideCard title="Ringkasan kerja" testId="work-summary">
            <dl className="flex flex-col gap-3 text-[15px]">
              <div>
                <dt className="text-sm font-semibold text-ink-2">Deadline</dt>
                <dd className={cn("mt-0.5", late ? "font-medium text-bad" : "text-ink")}>
                  {formatDeadline(order.deadlineAt)}
                  {!finished && <span className="block text-sm">{describeDeadline(order.deadlineAt, now)}</span>}
                </dd>
                {canEdit && !finished && <div className="mt-2"><DeadlineChangeButton orderId={order.id} deadlineAt={order.deadlineAt} /></div>}
              </div>
              <div>
                <dt className="text-sm font-semibold text-ink-2">PIC</dt>
                <dd className="mt-1">
                  <ul className="flex flex-col gap-1.5" aria-label="PIC pekerjaan">
                    {order.assignees.length === 0 && <li className="text-warn">Belum ada PIC</li>}
                    {order.assignees.map((a) => (
                      <li key={a.id} className="flex items-center gap-2">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white" aria-hidden="true">
                          {a.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")}
                        </span>
                        <span className="min-w-0 text-ink">{a.name}</span>
                        {a.id === session.memberId && <Badge tone="success">Anda</Badge>}
                        {!a.isActive && <Badge tone="muted">Nonaktif</Badge>}
                      </li>
                    ))}
                  </ul>
                  {order.assignees.length > 1 && <p className="mt-1.5 text-[13px] text-ink-2">Status berlaku untuk seluruh pekerjaan; sistem tidak mencatat pembagian tugas antar-PIC.</p>}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-ink-2">Status</dt>
                <dd className="mt-1 flex flex-col gap-1.5 text-sm">
                  <span className="flex items-center justify-between gap-2"><span className="text-ink-2">Pekerjaan</span> <StatusBadge status={order.status} /></span>
                  <span className="flex items-center justify-between gap-2" data-testid="qc-status"><span className="text-ink-2">QC</span> <Badge tone={QC_TONE[qcStatus]} dot>{QC_STATUS_LABEL[qcStatus]}</Badge></span>
                  <span className="flex items-center justify-between gap-2" data-testid="delivery-status"><span className="text-ink-2">Pengiriman</span> <Badge tone={DELIVERY_TONE[delivery]} dot>{DELIVERY_STATUS_LABEL[delivery]}</Badge></span>
                </dd>
              </div>
            </dl>
          </SideCard>
        </aside>

        <div className="flex min-w-0 flex-col gap-6 xl:col-start-1 xl:row-span-2 xl:row-start-1" data-testid="work-main">
          {accessRequest?.kind === "qc_access_requested" && (
            <div role="status" className="rounded-2xl border border-[#fbe2b8] bg-warn-soft p-5" data-testid="qc-access-note">
              <p className="flex items-center gap-2 text-base font-semibold text-warn"><KeyRound className="size-5" aria-hidden="true" /> Manager meminta file atau akses hasil</p>
              <p className="mt-2 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-ink">{accessRequest.summary}</p>
              <p className="mt-1 text-[13px] text-ink-2">{accessRequest.actorName ?? "Manager"} · {formatDateTime(accessRequest.at)} · Lengkapi file/akses lalu ajukan QC kembali.</p>
            </div>
          )}

          {revisionNote && (
            <div role="status" className="rounded-2xl border border-[#fbd5d1] bg-bad-soft p-5" data-testid="qc-revision-note">
              <p className="flex items-center gap-2 text-base font-semibold text-bad"><Undo2 className="size-5" aria-hidden="true" /> Manager meminta revisi</p>
              <p className="mt-2 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-ink">{revisionNote.summary}</p>
              <p className="mt-1 text-[13px] text-ink-2">{revisionNote.actorName ?? "Manager"} · {formatDateTime(revisionNote.at)}</p>
            </div>
          )}

          {/* Deskripsi dari Pemohon: sumber utama pemahaman PIC (field brief_rich/brief dari form pengajuan), ditampilkan sekali. */}
          <Section title="Deskripsi dari Pemohon" icon={<FileText className="size-5 text-accent" aria-hidden="true" />} id="brief" testId="brief">
            {hasDescription ? (
              <div className="text-base leading-[1.75] text-ink sm:text-[17px]">
                <RichTextView doc={order.briefRich} fallbackText={order.brief} />
              </div>
            ) : (
              <p className="text-[15px] text-ink-2">Pemohon belum mengisi deskripsi pekerjaan</p>
            )}
          </Section>

          {/* Spesifikasi: hanya nilai yang benar-benar diisi pada pengajuan. */}
          <Section title="Spesifikasi pekerjaan" icon={<ListChecks className="size-5 text-accent" aria-hidden="true" />} testId="specs">
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {specs.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-sm font-semibold text-ink-2">{k}</dt>
                  <dd className="mt-0.5 text-[15px] break-words text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title="Bahan referensi" icon={<Paperclip className="size-5 text-accent" aria-hidden="true" />} id="dokumen" testId="materials">
            <p className="-mt-2 mb-4 text-sm text-ink-2">{order.attachments.length} file{order.driveUrl ? " · tautan Google Drive" : ""}</p>
            <div className="flex flex-col gap-4">
              <AttachmentGallery attachments={order.attachments} />
              {order.driveUrl && (
                <div className="flex items-start gap-3 rounded-xl border border-line px-4 py-3">
                  <ExternalLink className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <a href={order.driveUrl} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className="block truncate text-[15px] font-medium text-accent hover:underline">{order.driveUrl}</a>
                    <p className="mt-0.5 text-[13px] text-ink-2">Google Drive pemohon. Akses mengikuti izin berbagi pemohon.</p>
                  </div>
                </div>
              )}
            </div>
          </Section>

          <Section title="Hasil pekerjaan" icon={<FileCheck2 className="size-5 text-accent" aria-hidden="true" />} id="hasil" testId="results">
            <p className="-mt-2 mb-4 text-sm text-ink-2">File output yang diunggah PIC; terpisah dari bahan referensi pemohon.</p>
            <ResultFiles orderId={order.id} files={resultViews} />
            <ResultLinks orderId={order.id} links={resultLinkViews} />
          </Section>

          <Section title="Penyerahan hasil & QC" icon={<Send className="size-5 text-accent" aria-hidden="true" />} id="penyerahan" testId="qc-panel">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line p-4">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-2"><ShieldCheck className="size-4 text-brand-violet" aria-hidden="true" /> Pemeriksaan Manager</h3>
                <p className="mt-2"><Badge tone={QC_TONE[qcStatus]} dot>{QC_STATUS_LABEL[qcStatus]}</Badge></p>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">
                  {qcStatus === "none" && "Hasil belum diajukan ke Manager. QC tidak wajib; PIC memilih tujuan penyerahan."}
                  {qcStatus === "pending" && "Menunggu keputusan Manager. Tidak ada persetujuan otomatis."}
                  {qcStatus === "approved" && "Hasil terakhir yang diajukan sudah disetujui Manager."}
                  {qcStatus === "revision" && "Manager meminta perbaikan; lihat instruksi revisi."}
                </p>
              </div>
              <div className="rounded-xl border border-line p-4">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-2"><Send className="size-4 text-brand-blue" aria-hidden="true" /> Pengiriman ke pemohon</h3>
                <p className="mt-2"><Badge tone={DELIVERY_TONE[delivery]} dot>{DELIVERY_STATUS_LABEL[delivery]}</Badge></p>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">
                  {delivery === "none" ? "Belum ada pengiriman yang dicatat PIC." : `${delivery === "after_qc" ? "Dikirim setelah QC Manager disetujui." : "Dikirim langsung, tanpa QC Manager."} Dicatat manual oleh PIC; pengiriman bukan berarti pemohon menyetujui hasil.`}
                </p>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-line p-4" data-testid="qc-last-result">
              <h3 className="text-sm font-semibold text-ink-2">Hasil terakhir</h3>
              {lastResult ? (
                <>
                  {lastResult.kind === "qc_submitted" && lastResult.detail.method === "external" && (
                    <div className="mt-1.5 text-[15px] text-ink" data-testid="qc-external-handover">
                      <p>
                        Diserahkan di luar DTIC Nexus via <span className="font-medium">{HANDOVER_CHANNEL_LABEL[lastResult.detail.channel as HandoverChannel] ?? "media lain"}</span>
                        {typeof lastResult.detail.recipient === "string" && <> kepada <span className="font-medium">{lastResult.detail.recipient}</span></>}
                        {typeof lastResult.detail.handedAt === "string" && <> pada {formatDateTime(lastResult.detail.handedAt)}</>}.
                      </p>
                      {lastResult.summary && <p className="mt-1 whitespace-pre-wrap text-ink-2">{lastResult.summary}</p>}
                      <p className="mt-1 text-[13px] text-ink-2">Keterangan dari PIC; sistem tidak memverifikasi penerimaan. Manager dapat meminta file atau akses bila belum bisa memeriksa.</p>
                    </div>
                  )}
                  {lastResult.kind === "qc_submitted" && lastResult.detail.method === "in_app" && (
                    <p className="mt-1.5 text-[15px] text-ink" data-testid="qc-dtic-nexus-handover">
                      Diserahkan melalui <span className="font-medium">{HANDOVER_CHANNEL_LABEL.dtic_nexus}</span>
                      {lastResult.actorName && <> oleh <span className="font-medium">{lastResult.actorName}</span></>} pada {formatDateTime(lastResult.at)} · <span className="font-medium">{QC_STATUS_LABEL[qcStatus]}</span>.
                    </p>
                  )}
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {fileIdsOf(lastResult).map((fid) => {
                      const f = results.find((r) => r.id === fid);
                      return f ? (
                        <li key={fid}><a href={`/api/internal/attachments/${fid}`} className="inline-flex max-w-full items-center gap-1.5 text-[15px] font-medium break-all text-accent hover:underline"><FileCheck2 className="size-4 shrink-0" aria-hidden="true" /> {f.fileName}</a></li>
                      ) : null;
                    })}
                    {lastResult.link && (
                      <li><a href={lastResult.link} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-[15px] font-medium break-all text-accent hover:underline">
                        <ExternalLink className="size-4 shrink-0" aria-hidden="true" /> {lastResult.link}
                      </a></li>
                    )}
                  </ul>
                  <p className="mt-1 text-[13px] text-ink-2">
                    {lastResult.kind === "qc_submitted" ? "Diajukan ke Manager (dicatat)" : lastResult.kind === "delivery_recorded" ? "Dikirim ke pemohon" : "Referensi penyelesaian"} · {lastResult.actorName ?? "PIC"} · {formatDateTime(lastResult.at)}
                  </p>
                </>
              ) : (
                <p className="mt-1.5 text-[15px] text-ink-2">Belum ada hasil yang diserahkan.</p>
              )}
            </div>
          </Section>

          <Section title="Riwayat aktivitas" icon={<CalendarClock className="size-5 text-accent" aria-hidden="true" />} testId="activity">
            <p className="-mt-2 mb-4 text-sm text-ink-2">Semua waktu dalam WIB (Asia/Jakarta).</p>
            <ActivityTimeline history={order.history} events={events} audit={audit} fileNames={Object.fromEntries(results.map((r) => [r.id, r.fileName]))} />
          </Section>
        </div>

        <aside className="flex min-w-0 flex-col gap-6 xl:col-start-2 xl:row-start-2 xl:self-start">
          {canAssign && (
            <SideCard title="Kelola PIC">
              <AssignmentField orderId={order.id} assignees={order.assignees} members={members} canAssign={canAssign} workloads={workloads} />
            </SideCard>
          )}

          <SideCard title="Pemohon" testId="requester">
            <dl className="flex flex-col gap-2.5 text-[15px]">
              <div><dt className="text-sm font-semibold text-ink-2">Nama</dt><dd className="text-ink">{order.requesterName}</dd></div>
              <div>
                <dt className="text-sm font-semibold text-ink-2">Brand / departemen</dt>
                <dd className="text-ink">{order.brandName}{!order.brandIsActive && <Badge tone="muted" className="ml-1.5">Nonaktif</Badge>} · {order.department}{order.company ? ` · ${order.company}` : ""}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-ink-2">WhatsApp</dt>
                <dd>
                  <span className="flex flex-wrap items-center gap-2">
                    {order.requesterWhatsapp ? (
                      <span className="font-mono text-ink">{formatWhatsappDisplay(order.requesterWhatsapp)}</span>
                    ) : (
                      <span className="text-ink-2">Belum tersedia (pengajuan sebelum nomor WhatsApp diwajibkan)</span>
                    )}
                    <WhatsappMessageButton
                      orderId={order.id}
                      number={order.requesterWhatsapp}
                      requesterName={order.requesterName}
                      orderNumber={order.orderNumber}
                      title={order.title}
                      statusLabel={STATUS_META[order.status].label}
                      senderName={session.name}
                      context={waContext}
                      contextLabel={waContextLabel}
                      resultFiles={results.map((r) => ({ id: r.id, fileName: r.fileName }))}
                    />
                  </span>
                </dd>
              </div>
              <div><dt className="text-sm font-semibold text-ink-2">Diajukan</dt><dd className="text-ink">{formatDateTime(order.createdAt)}</dd></div>
            </dl>
          </SideCard>

          <SideCard title="Catatan internal DTIC">
            <p className="-mt-1 mb-3 text-sm text-ink-2">Untuk koordinasi antar-PIC; tidak terlihat oleh pemohon.</p>
            <NotesEditor orderId={order.id} notes={order.internalNotes} editable={canEdit} />
          </SideCard>
        </aside>
      </div>
    </div>
  );
}
