import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { BrandListSkeleton } from "@/components/ui/skeletons";
import { TableScroll } from "@/components/ui/table-scroll";
import { formatDateTime } from "@/lib/dates";
import { requireSession } from "@/lib/server/auth";
import { listFeedbackTickets } from "@/lib/server/repositories/feedback";
import { buildQuery, pageParam } from "@/lib/search-params";
import { FEEDBACK_KIND_LABEL, FEEDBACK_STATUS_LABEL, FEEDBACK_STATUS_TONE } from "@/lib/validation/feedback";

export const metadata: Metadata = { title: "Tiket Saya" };

const PAGE_SIZE = 20;

/**
 * Tiket Bantuan & Masukan milik akun yang sedang login — bagian "Tiket Saya" pada Pusat Bantuan
 * mengambang (lihat FloatingHelpCenter), dibuka lewat URL langsung juga. Daftar sendiri saja (akses
 * detail/balasan memakai halaman pelacakan publik yang SUDAH ADA, /bantuan/riwayat — bukan halaman
 * detail baru, supaya tidak ada tampilan/logika percakapan ganda).
 */
export default function MyFeedbackPage({ searchParams }: PageProps<"/dtic/bantuan">) {
  return (
    <>
      <PageHeader title="Tiket Saya" description="Laporan kendala dan masukan yang pernah Anda kirim lewat Pusat Bantuan." breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Tiket Saya" }]} />
      <Suspense fallback={<BrandListSkeleton />}>
        <MyFeedbackContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function MyFeedbackContent({ searchParams }: { searchParams: PageProps<"/dtic/bantuan">["searchParams"] }) {
  await connection();
  const session = await requireSession();
  const sp = await searchParams;
  const page = pageParam(sp);
  const { rows, total } = await listFeedbackTickets({ reporterUserId: session.userId, page, pageSize: PAGE_SIZE });
  const hrefFor = (p: number) => `/dtic/bantuan${buildQuery({ page: p === 1 ? undefined : p })}`;

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={Ticket} title="Belum ada tiket" description="Tiket yang Anda buat lewat Pusat Bantuan (tombol mengambang di pojok kanan bawah) akan tampil di sini." />
      </Card>
    );
  }

  return (
    <Card>
      <TableScroll minWidthPx={760}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-ink-3 uppercase">
              <th className="px-4 py-3">Nomor</th>
              <th className="px-4 py-3">Jenis</th>
              <th className="px-4 py-3">Judul</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Dibuat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((t) => (
              <tr key={t.id} className="hover:bg-subtle">
                <td className="px-4 py-3">
                  <Link href={`/bantuan/riwayat?ticket=${encodeURIComponent(t.ticketNumber)}`} className="font-mono text-[13px] font-medium text-accent hover:underline">
                    {t.ticketNumber}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-2">{FEEDBACK_KIND_LABEL[t.kind]}</td>
                <td className="max-w-xs truncate px-4 py-3 text-ink">{t.title}</td>
                <td className="px-4 py-3"><Badge tone={FEEDBACK_STATUS_TONE[t.status]} dot>{FEEDBACK_STATUS_LABEL[t.status]}</Badge></td>
                <td className="px-4 py-3 text-ink-3">{formatDateTime(t.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={hrefFor} />
    </Card>
  );
}
