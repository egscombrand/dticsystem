import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ClipboardCheck, KeyRound, ShieldCheck, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TableScroll } from "@/components/ui/table-scroll";
import { BrandListSkeleton } from "@/components/ui/skeletons";
import { can } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/dates";
import { requireSession } from "@/lib/server/auth";
import { listQcHistory, type QcHistoryEntry } from "@/lib/server/repositories/qc";
import type { StatusTone } from "@/lib/status";

export const metadata: Metadata = { title: "Riwayat QC" };

const KIND_META: Record<QcHistoryEntry["kind"], { label: string; icon: typeof ShieldCheck; tone: StatusTone }> = {
  qc_approved: { label: "Disetujui", icon: ShieldCheck, tone: "success" },
  qc_revision_requested: { label: "Revisi diminta", icon: Undo2, tone: "danger" },
  qc_access_requested: { label: "Terkendala (file/akses)", icon: KeyRound, tone: "warning" },
};

export default function QcHistoryPage() {
  return (
    <>
      <PageHeader
        title="Riwayat QC"
        description="Riwayat keputusan QC (disetujui, revisi, terkendala) lintas pekerjaan. Hanya Manager & Super Admin."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Riwayat QC" }]}
      />
      <Suspense fallback={<BrandListSkeleton />}>
        <QcHistoryContent />
      </Suspense>
    </>
  );
}

async function QcHistoryContent() {
  await connection();
  const session = await requireSession();
  if (!can(session.role, "orders.view_all")) redirect("/dtic/unauthorized");
  const rows = await listQcHistory(100);

  return (
    <Card>
      {rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Belum ada keputusan QC" description="Keputusan Setujui, Minta Revisi, atau Tandai Terkendala akan tercatat di sini." />
      ) : (
        <TableScroll minWidthPx={760}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs font-medium tracking-wide text-ink-3 uppercase">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Pekerjaan</th>
                <th scope="col" className="px-4 py-3 font-medium">Keputusan</th>
                <th scope="col" className="px-4 py-3 font-medium">Pemeriksa</th>
                <th scope="col" className="px-4 py-3 font-medium">Catatan</th>
                <th scope="col" className="px-4 py-3 font-medium">Waktu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const meta = KIND_META[r.kind];
                const Icon = meta.icon;
                return (
                  <tr key={r.id} className="align-top hover:bg-subtle/70">
                    <td className="px-5 py-3">
                      <Link href={`/dtic/orders/${r.orderId}`} className="block hover:text-accent">
                        <span className="block truncate font-medium text-ink">{r.orderTitle}</span>
                        <span className="block font-mono text-xs text-ink-3">{r.orderNumber}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3"><Badge tone={meta.tone}><Icon className="size-3.5" aria-hidden="true" /> {meta.label}</Badge></td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-2">{r.actorName ?? "—"}</td>
                    <td className="max-w-[320px] px-4 py-3 text-ink-2">{r.summary ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-[13px] text-ink-3">{formatDateTime(r.at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  );
}
