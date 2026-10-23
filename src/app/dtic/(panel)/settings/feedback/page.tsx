import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import { CheckCircle2, Clock3, Inbox, ListChecks, MessageSquareReply } from "lucide-react";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { BrandListSkeleton } from "@/components/ui/skeletons";
import { StatCard } from "@/components/ui/stat-card";
import { TableScroll } from "@/components/ui/table-scroll";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/dates";
import { requireSession } from "@/lib/server/auth";
import { getFeedbackSummary, listFeedbackTickets } from "@/lib/server/repositories/feedback";
import { buildQuery, enumParam, first, pageParam } from "@/lib/search-params";
import {
  FEEDBACK_IMPACT_LABEL,
  FEEDBACK_IMPACTS,
  FEEDBACK_KIND_LABEL,
  FEEDBACK_KINDS,
  FEEDBACK_PRIORITY_LABEL,
  FEEDBACK_STATUS_LABEL,
  FEEDBACK_STATUSES,
} from "@/lib/validation/feedback";

export const metadata: Metadata = { title: "Bantuan & Masukan" };

const PAGE_SIZE = 20;

const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger" | "violet"> = {
  new: "info",
  reviewed: "violet",
  in_progress: "warning",
  need_info: "warning",
  done: "success",
  wont_fix: "neutral",
};

export default function FeedbackPage({ searchParams }: PageProps<"/dtic/settings/feedback">) {
  return (
    <>
      <PageHeader
        title="Bantuan & Masukan"
        description="Laporan bug, saran, permintaan fitur, dan pertanyaan dari pemohon maupun tim internal."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Bantuan & Masukan" }]}
      />
      <Suspense fallback={<BrandListSkeleton />}>
        <FeedbackContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function FeedbackContent({ searchParams }: { searchParams: PageProps<"/dtic/settings/feedback">["searchParams"] }) {
  await connection();
  const session = await requireSession();
  if (!can(session.role, "feedback.manage")) redirect("/dtic/unauthorized");

  const sp = await searchParams;
  const q = first(sp, "q");
  const kind = enumParam(sp, "kind", FEEDBACK_KINDS);
  const status = enumParam(sp, "status", FEEDBACK_STATUSES);
  const impact = enumParam(sp, "impact", FEEDBACK_IMPACTS);
  const page = pageParam(sp);

  const [summary, { rows, total }] = await Promise.all([
    getFeedbackSummary(),
    listFeedbackTickets({ q, kind, status, impact, page, pageSize: PAGE_SIZE }),
  ]);

  const hrefFor = (p: number) => `/dtic/settings/feedback${buildQuery({ q, kind, status, impact, page: p === 1 ? undefined : p })}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Total Laporan" value={summary.total} icon={Inbox} tone="neutral" />
        <StatCard label="Baru" value={summary.new} icon={ListChecks} tone="info" />
        <StatCard label="Sedang Ditangani" value={summary.inProgress} icon={Clock3} tone="warning" />
        <StatCard label="Menunggu Informasi" value={summary.needInfo} icon={MessageSquareReply} tone="warning" />
        <StatCard label="Selesai" value={summary.done} icon={CheckCircle2} tone="success" />
      </div>

      <Card>
        <form method="GET" className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="min-w-48 flex-1">
            <label htmlFor="q" className="mb-1 block text-xs font-medium text-ink-2">Cari</label>
            <input id="q" name="q" defaultValue={q ?? ""} placeholder="Nomor tiket, judul, atau nomor request" className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15" />
          </div>
          <div>
            <label htmlFor="kind" className="mb-1 block text-xs font-medium text-ink-2">Jenis</label>
            <select id="kind" name="kind" defaultValue={kind ?? ""} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink">
              <option value="">Semua</option>
              {FEEDBACK_KINDS.map((k) => <option key={k} value={k}>{FEEDBACK_KIND_LABEL[k]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="status" className="mb-1 block text-xs font-medium text-ink-2">Status</label>
            <select id="status" name="status" defaultValue={status ?? ""} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink">
              <option value="">Semua</option>
              {FEEDBACK_STATUSES.map((s) => <option key={s} value={s}>{FEEDBACK_STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="impact" className="mb-1 block text-xs font-medium text-ink-2">Dampak</label>
            <select id="impact" name="impact" defaultValue={impact ?? ""} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink">
              <option value="">Semua</option>
              {FEEDBACK_IMPACTS.map((i) => <option key={i} value={i}>{FEEDBACK_IMPACT_LABEL[i]}</option>)}
            </select>
          </div>
          <button type="submit" className="h-9 rounded-lg bg-navy px-4 text-[13px] font-medium text-white hover:bg-navy/90">Terapkan</button>
          {(q || kind || status || impact) && <Link href="/dtic/settings/feedback" className="text-[13px] font-medium text-ink-2 hover:text-ink">Reset</Link>}
        </form>

        {rows.length === 0 ? (
          <EmptyState icon={Inbox} title="Belum ada laporan" description="Laporan dari halaman Bantuan & Masukan akan muncul di sini." />
        ) : (
          <TableScroll minWidthPx={960}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Tiket</th>
                  <th scope="col" className="px-4 py-3 font-medium">Tanggal</th>
                  <th scope="col" className="px-4 py-3 font-medium">Jenis</th>
                  <th scope="col" className="px-4 py-3 font-medium">Judul</th>
                  <th scope="col" className="px-4 py-3 font-medium">Pelapor</th>
                  <th scope="col" className="px-4 py-3 font-medium">Request Terkait</th>
                  <th scope="col" className="px-4 py-3 font-medium">Dampak</th>
                  <th scope="col" className="px-4 py-3 font-medium">Prioritas</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Penanggung Jawab</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((t) => (
                  <tr key={t.id} className="align-top hover:bg-subtle/60">
                    <td className="px-4 py-3">
                      <Link href={`/dtic/settings/feedback/${t.id}`} className="font-mono font-medium text-accent hover:underline">{t.ticketNumber}</Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-3">{formatDateTime(t.createdAt)}</td>
                    <td className="px-4 py-3 text-ink-2">{FEEDBACK_KIND_LABEL[t.kind]}</td>
                    <td className="px-4 py-3 max-w-64 truncate text-ink" title={t.title}>{t.title}</td>
                    <td className="px-4 py-3 text-ink-2">{t.reporterName}</td>
                    <td className="px-4 py-3 font-mono text-ink-2">{t.relatedOrderNumber ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-2">{t.impact ? FEEDBACK_IMPACT_LABEL[t.impact].split(" — ")[0] : "—"}</td>
                    <td className="px-4 py-3 text-ink-2">{t.priority ? FEEDBACK_PRIORITY_LABEL[t.priority] : "—"}</td>
                    <td className="px-4 py-3"><Badge tone={STATUS_TONE[t.status]} dot>{FEEDBACK_STATUS_LABEL[t.status]}</Badge></td>
                    <td className="px-4 py-3 text-ink-2">{t.assigneeName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={hrefFor} />
    </div>
  );
}
