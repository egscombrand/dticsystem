import { RotateCcw, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { addDaysToKey } from "@/lib/dates";
import type { BrandOption } from "@/lib/types";

const control =
  "h-9 rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

/** Filter dashboard berbasis GET form (bekerja tanpa JavaScript). */
export function DashboardFilterBar({
  brands,
  fromKey,
  toKey,
  brandId,
  todayKey,
}: {
  brands: BrandOption[];
  fromKey?: string;
  toKey?: string;
  brandId?: string;
  /** Tanggal hari ini (WIB) untuk preset periode. */
  todayKey: string;
}) {
  const active = Boolean(fromKey || toKey || brandId);
  const presets = [7, 30, 90].map((n) => ({ n, from: addDaysToKey(todayKey, -(n - 1)), to: todayKey }));
  const selected = (p: { from: string; to: string }) => fromKey === p.from && toKey === p.to;
  return (
    <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3 shadow-card sm:p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="f-from" className="text-xs font-medium text-ink-3">Tanggal masuk dari</label>
        <input id="f-from" type="date" name="from" defaultValue={fromKey} className={control} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="f-to" className="text-xs font-medium text-ink-3">Sampai</label>
        <input id="f-to" type="date" name="to" defaultValue={toKey} className={control} />
      </div>
      <div className="flex min-w-40 flex-col gap-1">
        <label htmlFor="f-brand" className="text-xs font-medium text-ink-3">Brand pemohon</label>
        <select id="f-brand" name="brand" defaultValue={brandId ?? ""} className={control}>
          <option value="">Semua brand pemohon</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {!b.isActive ? " (nonaktif)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Periode cepat">
        {presets.map((p) => (
          <Link
            key={p.n}
            href={`/dtic/dashboard?from=${p.from}&to=${p.to}${brandId ? `&brand=${brandId}` : ""}`}
            aria-current={selected(p) ? "true" : undefined}
            className={`inline-flex h-9 items-center rounded-lg px-3 text-[13px] font-medium ring-1 ring-inset ${selected(p) ? "bg-accent-soft text-accent ring-accent/30" : "text-ink-2 ring-line hover:bg-subtle"}`}
          >
            {p.n} hari
          </Link>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="secondary" icon={<SlidersHorizontal className="size-3.5" />} className="h-9">
          Terapkan
        </Button>
        {active && (
          <Link href="/dtic/dashboard" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-ink-3 hover:bg-subtle hover:text-ink">
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset
          </Link>
        )}
      </div>
    </form>
  );
}
