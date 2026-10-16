import { ArrowRight, CalendarClock, KeyRound, MessageCircle, CheckCircle2, ClipboardCheck, MessageSquareReply, Send, ShieldCheck, Undo2, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { formatDateTime } from "@/lib/dates";
import { DELIVERY_STAGE_LABEL, HANDOVER_CHANNEL_LABEL, type DeliveryStage, type HandoverChannel, type WorkflowEventKind } from "@/lib/qc";
import type { WorkflowEvent } from "@/lib/server/repositories/qc";
import type { OrderActivity } from "@/lib/server/repositories/orders";
import type { StatusHistoryEntry } from "@/lib/types";

const EVENT: Record<WorkflowEventKind, { label: string; icon: LucideIcon; tone: string }> = {
  qc_submitted: { label: "Hasil diajukan ke Manager untuk QC", icon: ClipboardCheck, tone: "bg-brand-violet-soft text-[#5b21b6]" },
  qc_withdrawn: { label: "Pengajuan QC ditarik PIC", icon: Undo2, tone: "bg-subtle text-ink-2" },
  qc_approved: { label: "Manager menyetujui hasil", icon: ShieldCheck, tone: "bg-ok-soft text-ok" },
  qc_revision_requested: { label: "Manager meminta revisi", icon: Undo2, tone: "bg-bad-soft text-bad" },
  qc_access_requested: { label: "Manager meminta file atau akses hasil", icon: KeyRound, tone: "bg-warn-soft text-warn" },
  delivery_recorded: { label: "Pengiriman ke pemohon dicatat", icon: Send, tone: "bg-brand-sky text-brand-blue" },
  feedback_recorded: { label: "Masukan pemohon dicatat", icon: MessageSquareReply, tone: "bg-warn-soft text-warn" },
  completed: { label: "Pekerjaan diselesaikan", icon: CheckCircle2, tone: "bg-ok-soft text-ok" },
  whatsapp_opened: { label: "WhatsApp pemohon dibuka dengan pesan yang disiapkan", icon: MessageCircle, tone: "bg-subtle text-ink-2" },
};

type Item =
  | { key: string; at: string; type: "status"; h: StatusHistoryEntry }
  | { key: string; at: string; type: "event"; e: WorkflowEvent }
  | { key: string; at: string; type: "audit"; a: OrderActivity };

/**
 * Satu timeline untuk semua peristiwa yang benar-benar tercatat: perubahan status, QC, pengiriman, masukan,
 * penyelesaian, dan (bagi yang berwenang) perubahan PIC/deadline. Terbaru di atas, WIB.
 */
export function ActivityTimeline({ history, events, audit, fileNames = {} }: { history: StatusHistoryEntry[]; events: WorkflowEvent[]; audit: OrderActivity[]; fileNames?: Record<string, string> }) {
  const items: Item[] = [
    ...history.map((h): Item => ({ key: `s-${h.id}`, at: h.changedAt, type: "status", h })),
    ...events.map((e): Item => ({ key: `e-${e.id}`, at: e.at, type: "event", e })),
    ...audit.map((a): Item => ({ key: `a-${a.id}`, at: a.at, type: "audit", a })),
  ].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));

  if (items.length === 0) return <p className="text-[15px] text-ink-2">Belum ada aktivitas.</p>;

  return (
    <ol className="relative flex flex-col gap-5 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-line" aria-label="Riwayat aktivitas">
      {items.map((it) => {
        let icon: LucideIcon = ArrowRight;
        let tone = "bg-subtle text-ink-2";
        let title: ReactNode;
        let body: ReactNode = null;
        let actor: string | null = null;
        if (it.type === "status") {
          title = (
            <span className="flex flex-wrap items-center gap-1.5">
              {it.h.previousStatus ? <><StatusBadge status={it.h.previousStatus} /><ArrowRight className="size-3.5 text-ink-3" aria-label="menjadi" /></> : null}
              <StatusBadge status={it.h.newStatus} />
            </span>
          );
          actor = it.h.actor;
          if (it.h.notes) body = <p className="whitespace-pre-wrap">{it.h.notes}</p>;
        } else if (it.type === "event") {
          const m = EVENT[it.e.kind];
          icon = m.icon;
          tone = m.tone;
          const extras = [
            it.e.kind === "qc_submitted" && it.e.detail.method === "external"
              ? `diserahkan di luar DTIC Nexus via ${HANDOVER_CHANNEL_LABEL[it.e.detail.channel as HandoverChannel] ?? "media lain"}${typeof it.e.detail.recipient === "string" ? ` kepada ${it.e.detail.recipient}` : ""}${typeof it.e.detail.handedAt === "string" ? ` pada ${formatDateTime(it.e.detail.handedAt)}` : ""} (keterangan PIC)`
              : it.e.kind === "qc_submitted" && it.e.detail.method === "in_app" ? "file di DTIC Nexus" : null,
            (it.e.kind === "delivery_recorded" && typeof it.e.detail.sentAt === "string") || (it.e.kind === "qc_submitted" && it.e.detail.method === "in_app" && typeof it.e.detail.handedAt === "string")
              ? `diserahkan ${formatDateTime((it.e.detail.sentAt ?? it.e.detail.handedAt) as string)}`
              : null,
            it.e.kind === "delivery_recorded" ? (it.e.detail.afterQc === true ? "setelah QC disetujui" : "langsung, tanpa QC Manager") : null,
            it.e.stage ? DELIVERY_STAGE_LABEL[it.e.stage as DeliveryStage] : null,
            it.e.kind === "feedback_recorded" ? (it.e.needsRevision ? "ada revisi" : "tidak ada revisi") : null,
            it.e.kind === "completed" && it.e.detail.deliveryRecorded !== true ? "tanpa pengiriman tercatat di aplikasi" : null,
            it.e.kind === "whatsapp_opened" && typeof it.e.detail.templateLabel === "string" ? it.e.detail.templateLabel : null,
            it.e.kind === "whatsapp_opened" ? "belum tentu terkirim" : null,
          ].filter(Boolean);
          title = <span className="font-medium text-ink">{m.label}{extras.length ? <span className="font-normal text-ink-2"> · {extras.join(" · ")}</span> : null}</span>;
          actor = it.e.actorName;
          body = (
            <>
              {it.e.summary && <p className="whitespace-pre-wrap">{it.e.summary}</p>}
              {Array.isArray(it.e.detail.resultFileIds) && (it.e.detail.resultFileIds as string[]).length > 0 && (
                <p>File: {(it.e.detail.resultFileIds as string[]).map((fid) => fileNames[fid] ?? "file terhapus").join(", ")}</p>
              )}
              {it.e.link && <a href={it.e.link} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">{it.e.link}</a>}
            </>
          );
        } else {
          icon = it.a.kind === "pic" ? Users : CalendarClock;
          tone = it.a.kind === "pic" ? "bg-brand-violet-soft text-brand-violet" : "bg-brand-sky text-brand-blue";
          title = <span className="font-medium text-ink">{it.a.summary}</span>;
          actor = it.a.actorName;
          if (it.a.reason) body = <p>Alasan: {it.a.reason}</p>;
        }
        const Icon = icon;
        return (
          <li key={it.key} className="relative flex gap-3">
            <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface", tone)} aria-hidden="true"><Icon className="size-4" /></span>
            <div className="min-w-0 flex-1 pt-0.5 text-[15px] leading-relaxed">
              <div className="break-words">{title}</div>
              {body && <div className="mt-0.5 break-words text-ink-2">{body}</div>}
              <p className="mt-0.5 text-[13px] text-ink-2">{it.type === "event" ? "Dicatat " : ""}{formatDateTime(it.at)}{actor ? ` · ${actor}` : ""}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
