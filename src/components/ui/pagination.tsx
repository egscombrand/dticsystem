import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/components/ui/cn";

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const item = "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-[13px] font-medium";
  const disabled = cn(item, "text-[#b7bcc5] pointer-events-none");
  const enabled = cn(item, "text-ink-2 hover:bg-subtle hover:text-ink");

  const nums: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) nums.push(p);

  return (
    <nav aria-label="Pagination" className="flex flex-col items-center justify-between gap-3 px-5 py-3 sm:flex-row">
      <p className="text-[13px] text-ink-3">
        Menampilkan <span className="font-medium text-ink-2">{from}–{to}</span> dari <span className="font-medium text-ink-2">{total}</span> order
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={enabled} aria-label="Halaman sebelumnya">
            <ChevronLeft className="size-4" />
          </Link>
        ) : (
          <span className={disabled} aria-hidden="true"><ChevronLeft className="size-4" /></span>
        )}
        {nums.map((p) => (
          <Link key={p} href={hrefFor(p)} aria-current={p === page ? "page" : undefined} className={cn(item, p === page ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-subtle")}>
            {p}
          </Link>
        ))}
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className={enabled} aria-label="Halaman berikutnya">
            <ChevronRight className="size-4" />
          </Link>
        ) : (
          <span className={disabled} aria-hidden="true"><ChevronRight className="size-4" /></span>
        )}
      </div>
    </nav>
  );
}
