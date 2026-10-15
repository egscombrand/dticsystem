import type { BrandSummary } from "@/lib/server/repositories/dashboard";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** Ringkasan per brand: bar satu warna (magnitudo) + angka berlabel. */
export function BrandSummaryCard({ brands }: { brands: BrandSummary[] }) {
  const max = Math.max(1, ...brands.map((b) => b.total));
  return (
    <Card>
      <CardHeader title="Order per brand pemohon" description="Jumlah order masuk sesuai filter" />
      <ul className="divide-y divide-line">
        {brands.map((b) => (
          <li key={b.brandId} className="px-5 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{b.brandName}</span>
                {!b.isActive && <Badge tone="muted">Nonaktif</Badge>}
              </div>
              <span className="text-sm font-semibold text-ink tabular-nums">{b.total}</span>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eef0f3]"
              role="img"
              aria-label={`${b.brandName}: ${b.total} order`}
              title={`${b.brandName}: ${b.total} order, ${b.active} aktif, ${b.overdue} terlambat`}
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${(b.total / max) * 100}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-ink-3">
              {b.active} aktif
              {b.overdue > 0 && <span className="text-bad"> · {b.overdue} terlambat</span>}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
