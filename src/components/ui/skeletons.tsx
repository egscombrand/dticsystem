import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/spinner";

/** Fallback <Suspense> per halaman — bentuknya mengikuti konten asli agar layout tidak melompat. */

function Busy({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function FilterBarSkeleton() {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3 shadow-card sm:p-4">
      <Skeleton className="h-9 w-36" />
      <Skeleton className="h-9 w-36" />
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-9 w-24" />
    </div>
  );
}

function ListRows({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center justify-between gap-4 px-5 py-4">
          <div className="flex-1">
            <Skeleton className="h-4 w-2/3 max-w-72" />
            <Skeleton className="mt-2 h-3 w-1/2 max-w-56" />
          </div>
          <Skeleton className="h-5 w-24 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

export function DashboardSkeleton() {
  return (
    <Busy label="Memuat dashboard…">
      <FilterBarSkeleton />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="mt-4 h-7 w-12" />
            <Skeleton className="mt-3 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Order terbaru" description="Memuat…" />
          <ListRows />
        </Card>
        <Card>
          <CardHeader title="Order per brand pemohon" description="Memuat…" />
          <ListRows rows={5} />
        </Card>
      </div>
    </Busy>
  );
}

export function OrderTableSkeleton() {
  return (
    <Busy label="Memuat daftar order…">
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-12">
          <Skeleton className="h-9 sm:col-span-2 lg:col-span-4" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 lg:col-span-2" />
          ))}
        </div>
        <div className="hidden border-b border-line bg-subtle px-5 py-3 md:block">
          <Skeleton className="h-3 w-full max-w-3xl" />
        </div>
        <ul className="divide-y divide-line">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="grid grid-cols-2 items-center gap-4 px-5 py-4 md:grid-cols-[2fr_1fr_1.4fr_1.4fr_1fr_1fr_1fr]">
              <div>
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="mt-2 h-3 w-28" />
              </div>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="hidden h-4 w-24 md:block" />
              <Skeleton className="hidden h-4 w-28 md:block" />
              <Skeleton className="hidden h-5 w-16 rounded-full md:block" />
              <Skeleton className="hidden h-5 w-24 rounded-full md:block" />
              <Skeleton className="hidden h-4 w-20 md:block" />
            </li>
          ))}
        </ul>
      </Card>
    </Busy>
  );
}

export function OrderDetailSkeleton() {
  return (
    <Busy label="Memuat detail order…">
      <Skeleton className="h-3.5 w-48" />
      <Skeleton className="mt-3 h-7 w-80 max-w-full" />
      <Skeleton className="mt-2 mb-8 h-5 w-64" />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card>
            <CardHeader title="Brief desain" />
            <div className="space-y-2 p-5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          </Card>
          <Card>
            <CardHeader title="Informasi order" />
            <ListRows rows={6} />
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Status" />
            <div className="space-y-3 p-5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </Card>
          <Card>
            <CardHeader title="Riwayat status" />
            <ListRows rows={2} />
          </Card>
        </div>
      </div>
    </Busy>
  );
}

export function FormSkeleton() {
  return (
    <Busy label="Memuat formulir…">
      <Card className="max-w-4xl p-5 sm:p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="mt-2 h-10 w-full" />
            </div>
          ))}
        </div>
      </Card>
    </Busy>
  );
}

export function KanbanSkeleton() {
  return (
    <Busy label="Memuat workboard…">
      <div className="mb-5 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="w-[280px] shrink-0 rounded-xl border border-line bg-[#f1f3f5]/70 p-2.5">
            <Skeleton className="mx-1 mt-1 mb-3 h-4 w-28" />
            {Array.from({ length: 3 - (i % 2) }).map((__, j) => (
              <div key={j} className="mb-2.5 rounded-lg border border-line bg-surface p-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-2 h-4 w-full" />
                <Skeleton className="mt-3 h-5 w-16 rounded-full" />
                <Skeleton className="mt-3 h-8 w-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Busy>
  );
}

export function CalendarSkeleton() {
  return (
    <Busy label="Memuat kalender…">
      <div className="mb-5 flex items-center gap-2">
        <Skeleton className="size-9" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="size-9" />
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="h-9 border-b border-line bg-subtle" />
        <div className="grid grid-cols-7">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="min-h-14 border-r border-b border-line p-2 sm:min-h-28 [&:nth-child(7n)]:border-r-0">
              <Skeleton className="size-5 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </Busy>
  );
}

export function BrandListSkeleton() {
  return (
    <Busy label="Memuat brand…">
      <Card className="max-w-4xl">
        <CardHeader title="Daftar brand" description="Memuat…" />
        <ListRows rows={5} />
      </Card>
    </Busy>
  );
}
