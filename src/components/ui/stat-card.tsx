import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/components/ui/cn";

const iconTones = {
  neutral: "bg-subtle text-ink-2 ring-line",
  accent: "bg-accent-soft text-accent ring-[#c6e9e4]",
  info: "bg-info-soft text-info ring-[#dfe3fd]",
  warning: "bg-warn-soft text-warn ring-[#fbe2b8]",
  success: "bg-ok-soft text-ok ring-[#cdeed9]",
  danger: "bg-bad-soft text-bad ring-[#fbd5d1]",
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  href,
  active = false,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: LucideIcon;
  tone?: keyof typeof iconTones;
  href?: string;
  /** Tandai kartu ini sesuai filter/tab yang sedang aktif di halaman (bukan hover — kondisi saat ini). */
  active?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-2">{label}</p>
        <span className={cn("flex size-8 items-center justify-center rounded-lg ring-1 ring-inset", iconTones[tone])}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-[28px] leading-none font-semibold tracking-tight text-ink tabular-nums">{value.toLocaleString("id-ID")}</p>
      {hint && <p className="mt-2 text-xs text-ink-3">{hint}</p>}
    </>
  );
  const cls = cn("block rounded-xl border p-4 shadow-card sm:p-5", active ? "border-accent bg-accent-soft ring-1 ring-accent/30" : "border-line bg-surface");
  return href ? (
    <Link href={href} aria-current={active ? "true" : undefined} className={cn(cls, "transition-colors", !active && "hover:border-line-strong hover:bg-[#fcfcfd]")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
