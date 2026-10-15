import { canAccessOrder, requireSession } from "@/lib/server/auth";
import { can } from "@/lib/auth/permissions";
import { ExternalLink, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AssigneeList } from "@/components/assignments/assignee-list";
import { AssignmentField } from "@/components/assignments/assignment-field";
import { AttachmentList } from "@/components/orders/attachment-list";
import { RichTextView } from "@/components/rich-text/rich-text-view";
import { DeadlineText } from "@/components/orders/deadline-text";
import { DeleteOrderButton } from "@/components/orders/delete-order-button";
import { NotesEditor } from "@/components/orders/notes-editor";
import { StatusChanger } from "@/components/orders/status-changer";
import { StatusTimeline } from "@/components/orders/status-timeline";
import { Badge, OverdueBadge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { OrderDetailSkeleton } from "@/components/ui/skeletons";
import { formatDateTime } from "@/lib/dates";
import { formatWhatsappDisplay, whatsappLink } from "@/lib/whatsapp";
import { UUID_RE } from "@/lib/server/http";
import { listTeamMemberOptions } from "@/lib/server/repositories/master-data";
import { getMemberWorkloads } from "@/lib/server/repositories/workload";
import { getOrderDetail } from "@/lib/server/repositories/orders";
import { isOverdue } from "@/lib/status";
import { allowedTransitions } from "@/lib/workflow";

export const metadata: Metadata = { title: "Detail Pekerjaan" };

/** Tautan Google Drive dari client: ditampilkan apa adanya (sudah divalidasi https + domain Google), dibuka di tab baru. */
function DriveLink({ url }: { url: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
      <ExternalLink className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <a href={url} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className="block truncate text-sm font-medium text-accent hover:underline">
          {url}
        </a>
        <p className="mt-0.5 text-xs text-ink-3">Tautan eksternal Google Drive. Akses mengikuti izin berbagi yang diatur pemohon.</p>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3 py-2.5 text-sm">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
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
  const order = await getOrderDetail(id);
  if (!order) notFound();
  // Kandidat PIC hanya anggota aktif dari tim kategori order (server tetap memvalidasi ulang).
  const [members, workloads] = await Promise.all([
    listTeamMemberOptions(order.teamId),
    // Workload kandidat hanya untuk yang berwenang mengelola PIC, dan hanya untuk tim kategori order.
    canAssign && order.teamId ? getMemberWorkloads(order.teamId) : Promise.resolve([]),
  ]);
  const now = new Date();
  const late = isOverdue(order.deadlineAt, order.status, now);
  // Aksi status dihitung dari aturan terpusat (pelaku + PIC). Server tetap memeriksa ulang setiap permintaan.
  const isAssignee = !!session.memberId && order.assignees.some((a) => a.id === session.memberId);
  const statusActions = allowedTransitions(order.status, { role: session.role, isAssignee });

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Pengelolaan Pekerjaan", href: "/dtic/orders" }, { label: order.orderNumber }]}
        title={order.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-ink-2">{order.orderNumber}</span>
            <StatusBadge status={order.status} />
            <PriorityBadge name={order.priorityName} tone={order.priorityTone} />
            {late && <OverdueBadge />}
          </span>
        }
        actions={
          <>
            {canEdit && (
              <LinkButton href={`/dtic/orders/${order.id}/edit`} variant="secondary" icon={<Pencil className="size-4" />}>
                Edit detail
              </LinkButton>
            )}
            {canDelete && <DeleteOrderButton orderId={order.id} orderNumber={order.orderNumber} />}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card>
            <CardHeader title="Deskripsi desain" />
            <div className="flex flex-col gap-5 px-5 py-5">
              <section>
                <h3 className="text-xs font-medium tracking-wide text-ink-3 uppercase">Deskripsi dari pemohon</h3>
                <RichTextView doc={order.briefRich} fallbackText={order.brief} className="mt-1.5" />
              </section>
              {order.designRequirements && (
                <section>
                  <h3 className="text-xs font-medium tracking-wide text-ink-3 uppercase">Kebutuhan desain</h3>
                  <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-ink">{order.designRequirements}</p>
                </section>
              )}
              {order.briefReference && (
                <section>
                  <h3 className="text-xs font-medium tracking-wide text-ink-3 uppercase">Referensi</h3>
                  <p className="mt-1.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">{order.briefReference}</p>
                </section>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Informasi order" />
            <dl className="divide-y divide-line px-5 py-1">
              <Row label="Nomor order"><span className="font-mono">{order.orderNumber}</span></Row>
              <Row label="Timestamp masuk">{formatDateTime(order.createdAt)}</Row>
              <Row label="Pemohon">{order.requesterName}</Row>
              <Row label="Brand pemohon">
                <span className="inline-flex items-center gap-2">
                  {order.brandName}
                  {!order.brandIsActive && <Badge tone="muted">Nonaktif</Badge>}
                </span>
              </Row>
              {order.company && <Row label="Ket. perusahaan">{order.company}</Row>}
              <Row label="Departemen">{order.department}</Row>
              <Row label="WhatsApp">
                {order.requesterWhatsapp ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="font-mono">{formatWhatsappDisplay(order.requesterWhatsapp)}</span>
                    <a
                      href={whatsappLink(order.requesterWhatsapp)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center rounded-md border border-line-strong px-2 py-0.5 text-xs font-medium text-accent hover:bg-accent-soft"
                    >
                      Hubungi via WhatsApp
                    </a>
                  </span>
                ) : (
                  <span className="text-ink-3">Belum tersedia (pengajuan sebelum nomor WhatsApp diwajibkan)</span>
                )}
              </Row>
              <Row label="Jenis desain">{order.designType}</Row>
              <Row label="Ukuran">{order.designSize}</Row>
              {order.briefYear && <Row label="Tahun">{order.briefYear}</Row>}
              <Row label="Deadline"><DeadlineText deadlineAt={order.deadlineAt} status={order.status} now={now} /></Row>
              <Row label="Prioritas"><PriorityBadge name={order.priorityName} tone={order.priorityTone} /></Row>
              <Row label="PIC"><AssigneeList assignees={order.assignees} /></Row>
              <Row label="Terakhir diubah">{formatDateTime(order.updatedAt)}</Row>
              {order.completedAt && <Row label="Diselesaikan">{formatDateTime(order.completedAt)}</Row>}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Dokumen pendukung" description={`${order.attachments.length} file${order.driveUrl ? " + tautan Google Drive" : ""}`} />
            <div className="flex flex-col gap-4 p-5">
              <AttachmentList attachments={order.attachments} />
              {order.driveUrl && <DriveLink url={order.driveUrl} />}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Informasi pengerjaan" description="Deadline, PIC yang menangani, dan status order" />
            <div className="flex flex-col gap-5 p-5">
              <div>
                <p className="text-[13px] font-medium text-ink">Deadline</p>
                <div className="mt-1"><DeadlineText deadlineAt={order.deadlineAt} status={order.status} now={now} /></div>
              </div>
              <AssignmentField orderId={order.id} assignees={order.assignees} members={members} canAssign={canAssign} workloads={workloads} />
              <div className="border-t border-line pt-5">
                <StatusChanger orderId={order.id} status={order.status} actions={statusActions} />
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Catatan internal DTIC" />
            <div className="p-5">
              <NotesEditor orderId={order.id} notes={order.internalNotes} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Riwayat status" />
            <div className="p-5">
              <StatusTimeline history={order.history} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
