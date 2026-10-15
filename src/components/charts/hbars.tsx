import Link from "next/link";

export type BarItem = { key: string; label: string; value: number; href?: string; tone?: "accent" | "info" | "warning" | "danger" | "success" | "neutral" };

const FILL: Record<NonNullable<BarItem["tone"]>, string> = {
  accent: "bg-accent",
  info: "bg-info",
  warning: "bg-warning",
  danger: "bg-bad",
  success: "bg-ok",
  neutral: "bg-ink-3",
};

/** Batang horizontal (CSS, responsif). Nilai ditampilkan sebagai teks; batang bisa berupa tautan ke daftar sumbernya. */
export function HBars({ items, emptyText = "Belum ada data.", unit = "" }: { items: BarItem[]; emptyText?: string; unit?: string }) {
  if (items.length === 0) return <p className="text-sm text-ink-3">{emptyText}</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((i) => {
        const pct = Math.max(i.value > 0 ? 3 : 0, (i.value / max) * 100);
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-ink">{i.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-ink">{i.value}{unit}</span>
            </span>
            <span className="mt-1 block h-2 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
              <span className={`block h-full rounded-full ${FILL[i.tone ?? "accent"]}`} style={{ width: `${pct}%` }} />
            </span>
          </>
        );
        return (
          <li key={i.key}>
            {i.href ? (
              <Link href={i.href} className="block rounded-md px-1 py-0.5 hover:bg-subtle focus-visible:outline-offset-2" aria-label={`${i.label}: ${i.value}${unit}. Lihat daftar`}>
                {body}
              </Link>
            ) : (
              <div className="px-1 py-0.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
