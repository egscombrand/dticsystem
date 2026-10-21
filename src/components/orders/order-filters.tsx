"use client";

import { Loader2, RotateCcw, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { MoreFiltersToggle } from "@/components/orders/more-filters-toggle";
import type { OrderView } from "@/components/orders/order-tabs";
import { QC_STATUS_LABEL, QC_STATUSES } from "@/lib/qc";
import { ACTION_NEEDED_STATUSES, ACTIVE_STATUSES, FINISHED_STATUSES, STATUS_META, type OrderStatus } from "@/lib/status";
import type { BrandOption, MemberOption, PriorityOption, TeamOption } from "@/lib/types";

const control =
  "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

export type OrderFilterValues = {
  q?: string;
  brand?: string;
  status?: string;
  priority?: string;
  deadline?: string;
  pic?: string;
  team?: string;
  qc?: string;
  sort?: string;
};

const SEARCH_DEBOUNCE_MS = 400;

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

const VIEW_STATUS_OPTIONS: Record<OrderView, readonly OrderStatus[]> = {
  active: ACTIVE_STATUSES,
  action: ACTION_NEEDED_STATUSES,
  finished: FINISHED_STATUSES,
  qc: ["pending_confirmation"],
};
const VIEW_STATUS_PLACEHOLDER: Record<OrderView, string> = {
  active: "Semua status aktif",
  action: "Semua status perlu tindakan",
  finished: "Semua status selesai/dibatalkan",
  qc: "Menunggu QC",
};

export function OrderFilters({
  brands,
  priorities,
  members,
  teams,
  values,
  view,
  resultCount,
  /** PIC hanya relevan untuk Super Admin/Manager (orders.view_all) — Staff sudah otomatis dibatasi pada
   *  order miliknya sendiri di backend, jadi filter PIC lain tidak berarti apa-apa untuknya. */
  canFilterByPic,
}: {
  brands: BrandOption[];
  priorities: PriorityOption[];
  members: MemberOption[];
  teams: TeamOption[];
  values: OrderFilterValues;
  view: OrderView;
  /** Total hasil SETELAH filter (dari count() sungguhan di server) — ditampilkan sebagai indikator jumlah hasil. */
  resultCount: number;
  canFilterByPic: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [q, setQ] = useState(values.q ?? "");
  const [syncedQ, setSyncedQ] = useState(values.q ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sinkronkan input pencarian saat `q` di URL berubah dari LUAR komponen ini (klik StatCard/tab, tombol
  // back/forward) — pola "adjust state during render" React, bukan useEffect (menghindari render tambahan).
  if (syncedQ !== (values.q ?? "")) {
    setSyncedQ(values.q ?? "");
    setQ(values.q ?? "");
  }

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const navigate = useCallback(
    (patch: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "") params.delete(k);
        else params.set(k, v);
      }
      params.delete("page"); // filter berubah → kembali ke halaman pertama
      const qs = params.toString();
      startTransition(() => router.push(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  const onSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setQ(val);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => navigate({ q: val || undefined }), SEARCH_DEBOUNCE_MS);
    },
    [navigate],
  );

  const onFieldChange = useCallback((key: string) => (e: React.ChangeEvent<HTMLSelectElement>) => navigate({ [key]: e.target.value || undefined }), [navigate]);

  const reset = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQ("");
    startTransition(() => router.push(view !== "active" ? `${pathname}?view=${view}` : pathname, { scroll: false }));
  }, [pathname, router, view]);

  const primaryActive = Boolean(values.q || values.status);
  const secondaryActive = [values.brand, values.team, values.priority, values.deadline, canFilterByPic && values.pic, values.qc].filter(Boolean);
  const anyActive = primaryActive || secondaryActive.length > 0;
  const statusOptions = VIEW_STATUS_OPTIONS[view];

  return (
    <div role="search" className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-12" aria-busy={isPending}>
      {/* Kontrol utama: selalu terlihat. */}
      <div className="relative sm:col-span-2 lg:col-span-5">
        <label htmlFor="q" className="sr-only">Cari order</label>
        {isPending ? (
          <Loader2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-accent" aria-hidden="true" />
        ) : (
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
        )}
        <input id="q" name="q" value={q} onChange={onSearchChange} type="search" placeholder="Cari nomor order, pemohon, perusahaan, judul…" className={`${control} pl-9`} maxLength={100} />
      </div>
      <div className="lg:col-span-3">
        <label htmlFor="status" className="sr-only">Status pekerjaan</label>
        <select id="status" name="status" value={values.status ?? ""} onChange={onFieldChange("status")} className={control}>
          <option value="">{VIEW_STATUS_PLACEHOLDER[view]}</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4 lg:justify-end">
        <p className="text-[13px] text-ink-3" aria-live="polite">{resultCount.toLocaleString("id-ID")} hasil</p>
        {anyActive && (
          <button type="button" onClick={reset} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-ink-3 hover:bg-subtle hover:text-ink">
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset Filter
          </button>
        )}
      </div>

      {/* Filter Lainnya: Penugasan, Klasifikasi, Deadline, QC — dikelompokkan, tidak selalu terlihat. */}
      <MoreFiltersToggle activeCount={secondaryActive.length}>
        {canFilterByPic && (
          <div className="lg:col-span-3">
            <label htmlFor="pic" className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Penugasan (PIC)</label>
            <select id="pic" name="pic" value={values.pic ?? ""} onChange={onFieldChange("pic")} className={control}>
              <PicFilterOptions members={members} />
            </select>
          </div>
        )}
        <div className="lg:col-span-3">
          <label htmlFor="team" className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Klasifikasi (Kategori)</label>
          <select id="team" name="team" value={values.team ?? ""} onChange={onFieldChange("team")} className={control}>
            <option value="">Semua kategori</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-3">
          <label htmlFor="deadline" className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Deadline</label>
          <select id="deadline" name="deadline" value={values.deadline ?? ""} onChange={onFieldChange("deadline")} className={control}>
            <option value="">Semua deadline</option>
            <option value="overdue">Terlambat</option>
            <option value="today">Hari ini</option>
            <option value="week">7 hari ke depan</option>
            <option value="month">Bulan ini</option>
          </select>
        </div>
        <div className="lg:col-span-3">
          <label htmlFor="qc" className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Status QC</label>
          <select id="qc" name="qc" value={values.qc ?? ""} onChange={onFieldChange("qc")} className={control}>
            <option value="">Semua status QC</option>
            {QC_STATUSES.map((s) => (
              <option key={s} value={s}>{QC_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-3">
          <label htmlFor="brand" className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Brand pemohon</label>
          <select id="brand" name="brand" value={values.brand ?? ""} onChange={onFieldChange("brand")} className={control}>
            <option value="">Semua brand</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}{!b.isActive ? " (nonaktif)" : ""}</option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-3">
          <label htmlFor="priority" className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Prioritas</label>
          <select id="priority" name="priority" value={values.priority ?? ""} onChange={onFieldChange("priority")} className={control}>
            <option value="">Semua prioritas</option>
            {priorities.map((p) => (
              <option key={p.code} value={p.code}>{p.name}{!p.isActive ? " (nonaktif)" : ""}</option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-3">
          <label htmlFor="sort" className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Urutkan</label>
          <select id="sort" name="sort" value={values.sort ?? "newest"} onChange={onFieldChange("sort")} className={control}>
            <option value="newest">Masuk terbaru</option>
            <option value="oldest">Masuk terlama</option>
            <option value="deadline_asc">Deadline terdekat</option>
            <option value="deadline_desc">Deadline terjauh</option>
          </select>
        </div>
      </MoreFiltersToggle>
    </div>
  );
}
