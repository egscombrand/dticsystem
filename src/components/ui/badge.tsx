import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { QC_STATUS_LABEL, QC_STATUS_TONE, type QcStatus } from "@/lib/qc";
import { isStatusTone, statusLabel, statusTone, type HistoryStatus, type OrderStatus, type StatusTone } from "@/lib/status";

const tones: Record<StatusTone, string> = {
  neutral: "bg-[#f2f4f7] text-ink-2 ring-[#e4e7ec]",
  accent: "bg-accent-soft text-accent ring-[#c6e9e4]",
  info: "bg-info-soft text-info ring-[#dfe3fd]",
  warning: "bg-warn-soft text-warn ring-[#fbe2b8]",
  success: "bg-ok-soft text-ok ring-[#cdeed9]",
  danger: "bg-bad-soft text-bad ring-[#fbd5d1]",
  muted: "bg-[#f4f5f7] text-ink-3 ring-[#e6e8eb]",
  violet: "bg-brand-violet-soft text-[#5b21b6] ring-[#ddd6fe]",
};

const dots: Record<StatusTone, string> = {
  neutral: "bg-ink-3",
  accent: "bg-accent",
  info: "bg-info",
  warning: "bg-warn",
  success: "bg-ok",
  danger: "bg-bad",
  muted: "bg-[#9aa1ad]",
  violet: "bg-brand-violet",
};

export function Badge({ tone = "neutral", children, dot, className }: { tone?: StatusTone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dots[tone])} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Badge status. Menerima juga kode status lama dari riwayat (ditampilkan dengan label "(lama)"). */
export function StatusBadge({ status }: { status: OrderStatus | HistoryStatus | string }) {
  return (
    <Badge tone={statusTone(status)} dot>
      {statusLabel(status)}
    </Badge>
  );
}

/** Badge status QC — SELALU terpisah dari StatusBadge (status pekerjaan). "none" sengaja tidak ditampilkan
 *  di tabel (belum pernah diajukan QC bukan informasi yang perlu badge sendiri); pemanggil memutuskan itu. */
export function QcBadge({ status }: { status: QcStatus }) {
  return <Badge tone={QC_STATUS_TONE[status]}>{QC_STATUS_LABEL[status]}</Badge>;
}

/** Badge prioritas — nama & warna berasal dari tabel priority_levels. */
export function PriorityBadge({ name, tone }: { name: string; tone: string }) {
  return <Badge tone={isStatusTone(tone) ? tone : "neutral"}>{name}</Badge>;
}

export function OverdueBadge() {
  return (
    <Badge tone="danger">
      <AlertTriangle className="size-3" aria-hidden="true" />
      Terlambat
    </Badge>
  );
}
