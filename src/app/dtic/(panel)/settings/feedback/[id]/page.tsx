import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import { Download, Eye, FileText, Paperclip } from "lucide-react";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { OrderDetailSkeleton } from "@/components/ui/skeletons";
import { can } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/dates";
import { UUID_RE } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { getFeedbackTicketById, listFeedbackAttachments, listFeedbackEvents, listInternalAssignees } from "@/lib/server/repositories/feedback";
import { getFeedbackNotificationStatus, listFeedbackNotificationAttempts } from "@/lib/server/repositories/feedback-telegram";
import { FeedbackActions } from "@/components/feedback/feedback-actions";
import { FeedbackNotificationStatusCard } from "@/components/feedback/feedback-notification-status";
import { FEEDBACK_IMPACT_LABEL, FEEDBACK_KIND_LABEL, FEEDBACK_PAGE_LABEL, FEEDBACK_STATUS_LABEL } from "@/lib/validation/feedback";
import { PREVIEWABLE_MIME, formatFileSize } from "@/lib/files";

export const metadata: Metadata = { title: "Detail Laporan" };

const EVENT_LABEL: Record<string, string> = {
  created: "Laporan dibuat",
  status_changed: "Status diubah",
  priority_changed: "Prioritas diubah",
  assignee_changed: "Penanggung jawab diubah",
  note_added: "Catatan internal ditambahkan",
  info_requested: "Informasi tambahan diminta",
  info_provided: "Pelapor menjawab",
  resolved: "Diselesaikan",
  wont_fix: "Tidak ditindaklanjuti",
};

export default function FeedbackDetailPage({ params }: PageProps<"/dtic/settings/feedback/[id]">) {
  return (
    <>
      <PageHeader title="Detail Laporan" breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Bantuan & Masukan", href: "/dtic/settings/feedback" }, { label: "Detail" }]} />
      <Suspense fallback={<OrderDetailSkeleton />}>
        <DetailContent params={params} />
      </Suspense>
    </>
  );
}

async function DetailContent({ params }: { params: PageProps<"/dtic/settings/feedback/[id]">["params"] }) {
  await connection();
  const session = await requireSession();
  if (!can(session.role, "feedback.manage")) redirect("/dtic/unauthorized");

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const ticket = await getFeedbackTicketById(id);
  if (!ticket) notFound();

  const [events, attachments, assignees, notificationStatus, notificationAttempts] = await Promise.all([
    listFeedbackEvents(id),
    listFeedbackAttachments(id),
    listInternalAssignees(),
    getFeedbackNotificationStatus(id),
    listFeedbackNotificationAttempts(id),
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-6">
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-sm text-ink-3">{ticket.ticketNumber}</p>
              <h1 className="mt-1 text-lg font-semibold text-ink">{ticket.title}</h1>
            </div>
            <Badge tone="info">{FEEDBACK_KIND_LABEL[ticket.kind]}</Badge>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
            <div><dt className="text-ink-3">Pelapor</dt><dd className="font-medium text-ink">{ticket.reporterName}{ticket.reporterUserId ? " (internal)" : ""}</dd></div>
            <div><dt className="text-ink-3">Kontak</dt><dd className="font-medium text-ink">{ticket.reporterContact ?? "—"}</dd></div>
            <div><dt className="text-ink-3">Halaman terkait</dt><dd className="font-medium text-ink">{FEEDBACK_PAGE_LABEL[ticket.relatedPage]}</dd></div>
            <div><dt className="text-ink-3">Dampak dilaporkan</dt><dd className="font-medium text-ink">{ticket.impact ? FEEDBACK_IMPACT_LABEL[ticket.impact] : "—"}</dd></div>
            <div><dt className="text-ink-3">Tanggal lapor</dt><dd className="font-medium text-ink">{formatDateTime(ticket.createdAt)}</dd></div>
            <div>
              <dt className="text-ink-3">Request terkait</dt>
              <dd className="font-medium text-ink">
                {ticket.relatedOrderNumber ? <Link href={`/dtic/orders/${ticket.relatedOrderId}`} className="font-mono text-accent hover:underline">{ticket.relatedOrderNumber}</Link> : "—"}
              </dd>
            </div>
          </dl>
          <div className="mt-4">
            <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">Detail Laporan</p>
            <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap text-ink">{ticket.detail}</p>
          </div>
        </Card>

        {attachments.length > 0 && (
          <Card className="p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Paperclip className="size-4 text-ink-2" aria-hidden="true" /> Lampiran</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {attachments.map((f) => {
                const previewable = PREVIEWABLE_MIME.has(f.mimeType);
                return (
                  <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg bg-subtle px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 truncate text-[13px] text-ink"><FileText className="size-4 shrink-0 text-ink-3" aria-hidden="true" />{f.fileName} <span className="shrink-0 text-ink-3">· {formatFileSize(f.fileSize)}</span></span>
                    <span className="flex shrink-0 gap-1">
                      {previewable && (
                        <a href={`/api/internal/feedback/attachments/${f.id}?inline=1`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg p-1.5 text-ink-2 hover:bg-subtle hover:text-ink" aria-label={`Lihat ${f.fileName}`} title="Lihat">
                          <Eye className="size-4" aria-hidden="true" />
                        </a>
                      )}
                      <a href={`/api/internal/feedback/attachments/${f.id}`} className="inline-flex items-center gap-1 rounded-lg p-1.5 text-accent hover:bg-accent-soft" aria-label={`Unduh ${f.fileName}`} title="Unduh">
                        <Download className="size-4" aria-hidden="true" />
                      </a>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card className="p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-ink">Audit Trail</h2>
          <ol className="mt-3 flex flex-col gap-3">
            {events.map((e) => (
              <li key={e.id} className="border-l-2 border-line pl-3">
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
                  {EVENT_LABEL[e.kind] ?? e.kind}
                  {!e.visibleToReporter && <Badge tone="neutral">Internal</Badge>}
                  {e.visibleToReporter && e.kind !== "created" && <Badge tone="info">Terlihat pelapor</Badge>}
                </p>
                {e.message && <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-ink-2">{e.message}</p>}
                <p className="mt-0.5 text-[12px] text-ink-3">{e.actorName ?? "Sistem"} · {formatDateTime(e.at)}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <FeedbackNotificationStatusCard ticketId={ticket.id} status={notificationStatus} attempts={notificationAttempts} />
        <Card className="p-5">
          <div className="mb-3"><Badge tone="info">{FEEDBACK_STATUS_LABEL[ticket.status]}</Badge></div>
          <FeedbackActions
            ticketId={ticket.id}
            status={ticket.status}
            priority={ticket.priority}
            assigneeUserId={ticket.assigneeUserId}
            assignees={assignees}
            resolutionSummary={ticket.resolutionSummary}
            closeReason={ticket.closeReason}
          />
        </Card>
      </div>
    </div>
  );
}
