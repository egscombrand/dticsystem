import { RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ORDER_STATUSES, STATUS_GROUPS, STATUS_META } from "@/lib/status";
import type { BrandOption, MemberOption, PriorityOption } from "@/lib/types";

const control =
  "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

export type OrderFilterValues = {
  q?: string;
  brand?: string;
  status?: string;
  priority?: string;
  deadline?: string;
  pic?: string;
  sort?: string;
};

/** Opsi filter PIC dikelompokkan per divisi (+ "Belum ada PIC"). */
export function PicFilterOptions({ members }: { members: MemberOption[] }) {
  const groups = new Map<string, MemberOption[]>();
  for (const m of members) groups.set(m.departmentName, [...(groups.get(m.departmentName) ?? []), m]);
  return (
    <>
      <option value="">Semua PIC</option>
      <option value="none">Belum ada PIC</option>
      {[...groups.entries()].map(([dept, list]) => (
        <optgroup key={dept} label={dept}>
          {list.map((m) => (
            <option key={m.id} value={m.id}>{m.name}{!m.isActive ? " (nonaktif)" : ""}</option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

export function OrderFilters({ brands, priorities, members, values }: { brands: BrandOption[]; priorities: PriorityOption[]; members: MemberOption[]; values: OrderFilterValues }) {
  const active = Object.entries(values).some(([k, v]) => k !== "sort" && v);
  return (
    <form method="get" role="search" className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-12">
      <div className="relative sm:col-span-2 lg:col-span-4">
        <label htmlFor="q" className="sr-only">Cari order</label>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
        <input id="q" name="q" type="search" defaultValue={values.q} placeholder="Cari nomor order, pemohon, perusahaan, judul…" className={`${control} pl-9`} maxLength={100} />
      </div>
      <div className="lg:col-span-2">
        <label htmlFor="brand" className="sr-only">Brand pemohon</label>
        <select id="brand" name="brand" defaultValue={values.brand ?? ""} className={control}>
          <option value="">Semua brand</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {!b.isActive ? " (nonaktif)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="lg:col-span-2">
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={values.status ?? ""} className={control}>
          <option value="">Semua status</option>
          <optgroup label="Status">
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_META[s].label}</option>
            ))}
          </optgroup>
          <optgroup label="Kelompok">
            {STATUS_GROUPS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </optgroup>
        </select>
      </div>
      <div className="lg:col-span-2">
        <label htmlFor="priority" className="sr-only">Prioritas</label>
        <select id="priority" name="priority" defaultValue={values.priority ?? ""} className={control}>
          <option value="">Semua prioritas</option>
          {priorities.map((p) => (
            <option key={p.code} value={p.code}>{p.name}{!p.isActive ? " (nonaktif)" : ""}</option>
          ))}
        </select>
      </div>
      <div className="lg:col-span-2">
        <label htmlFor="deadline" className="sr-only">Deadline</label>
        <select id="deadline" name="deadline" defaultValue={values.deadline ?? ""} className={control}>
          <option value="">Semua deadline</option>
          <option value="overdue">Terlambat</option>
          <option value="today">Hari ini</option>
          <option value="week">7 hari ke depan</option>
          <option value="month">Bulan ini</option>
        </select>
      </div>
      <div className="lg:col-span-3">
        <label htmlFor="pic" className="sr-only">PIC</label>
        <select id="pic" name="pic" defaultValue={values.pic ?? ""} className={control}>
          <PicFilterOptions members={members} />
        </select>
      </div>
      <div className="lg:col-span-3">
        <label htmlFor="sort" className="sr-only">Urutkan</label>
        <select id="sort" name="sort" defaultValue={values.sort ?? "newest"} className={control}>
          <option value="newest">Urutkan: masuk terbaru</option>
          <option value="oldest">Urutkan: masuk terlama</option>
          <option value="deadline_asc">Urutkan: deadline terdekat</option>
          <option value="deadline_desc">Urutkan: deadline terjauh</option>
        </select>
      </div>
      <div className="flex items-center justify-end gap-2 sm:col-span-2 lg:col-span-6">
        {active && (
          <Link href="/dtic/orders" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-ink-3 hover:bg-subtle hover:text-ink">
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset
          </Link>
        )}
        <Button type="submit" size="sm" className="h-9">Terapkan filter</Button>
      </div>
    </form>
  );
}
