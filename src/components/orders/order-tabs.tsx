import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { buildQuery } from "@/lib/search-params";

export type OrderView = "active" | "action" | "finished" | "qc";

/**
 * Tab "Semua Aktif" / "Perlu Tindakan" / "Selesai & Dibatalkan". "Perlu Tindakan" adalah SUBSET dari Aktif
 * (lihat ACTION_NEEDED_STATUSES di src/lib/status.ts) — ditampilkan sebagai tab terpisah karena ini yang
 * paling sering dicari penggun (bukan karena itu kelompok status yang berbeda secara resmi). Berpindah tab
 * TIDAK mengubah data order — hanya navigasi ke URL dengan `view` berbeda; `page` dan `status` (sub-filter
 * dalam tab) sengaja direset karena opsi status berbeda per tab dan nomor halaman bisa tidak valid lagi.
 */
export function OrderTabs({
  view,
  activeCount,
  actionCount,
  finishedCount,
  qcCount,
  query,
}: {
  view: OrderView;
  activeCount: number;
  actionCount: number;
  finishedCount: number;
  /** undefined = tab QC disembunyikan (bukan Manager/Super Admin — lihat orders.view_all). */
  qcCount?: number;
  query: Record<string, string | number | undefined>;
}) {
  const tabs: { key: OrderView; label: string; count: number }[] = [
    { key: "active", label: "Semua Aktif", count: activeCount },
    { key: "action", label: "Perlu Tindakan", count: actionCount },
    ...(qcCount !== undefined ? [{ key: "qc" as const, label: "Antrean QC", count: qcCount }] : []),
    { key: "finished", label: "Selesai & Dibatalkan", count: finishedCount },
  ];
  return (
    <nav aria-label="Tampilan pekerjaan" className="mb-5 flex gap-1.5 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const isActive = t.key === view;
        return (
          <Link
            key={t.key}
            data-tour={`orders-tab-${t.key}`}
            href={`/dtic/orders${buildQuery({ ...query, view: t.key === "active" ? undefined : t.key, status: undefined, page: undefined })}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-[14.5px] font-medium transition-colors",
              isActive ? "border-accent text-accent" : "border-transparent text-ink-2 hover:border-line-strong hover:text-ink",
            )}
          >
            {t.label}
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", isActive ? "bg-accent-soft text-accent" : "bg-subtle text-ink-3")}>
              {t.count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
