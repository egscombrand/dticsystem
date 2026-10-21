import { Check, CheckCircle2, ClipboardCheck, Clock, FileEdit, LoaderCircle, type LucideIcon, RefreshCw, RotateCcw } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { WORK_STAGES, WORK_STAGE_LABEL, type WorkStage } from "@/lib/work-stage";

const REVISION_ONLY_STAGES = new Set<WorkStage>(["needs_revision", "pending_rereview"]);

/** Satu ikon tetap per tahap (identitas visual, bukan hanya warna — lihat aturan aksesibilitas). */
const STAGE_ICON: Record<Exclude<WorkStage, "done">, LucideIcon> = {
  waiting_start: Clock,
  in_progress: LoaderCircle,
  draft_result: FileEdit,
  pending_review: ClipboardCheck,
  needs_revision: RotateCcw,
  pending_rereview: RefreshCw,
  approved: CheckCircle2,
};

const STAGE_HINT: Record<Exclude<WorkStage, "done">, string> = {
  waiting_start: "Belum ada yang mulai mengerjakan.",
  in_progress: "PIC sedang mengerjakan.",
  draft_result: "Ada draf hasil tersimpan, belum diajukan QC.",
  pending_review: "Menunggu pemeriksaan pertama oleh Manager.",
  needs_revision: "Manager meminta perbaikan — PIC perlu menindaklanjuti.",
  pending_rereview: "Hasil revisi menunggu diperiksa ulang oleh Manager.",
  approved: "Hasil sudah disetujui Manager.",
};

/**
 * Ringkasan visual tahap pekerjaan saat ini — riwayat lengkap (pelaku, waktu, catatan) tetap di
 * ActivityTimeline. "done" (pekerjaan selesai) divisualkan sebagai seluruh 7 tahap tercapai, berhenti di
 * "Disetujui" — tidak ada node ke-8 terpisah, sesuai tujuh tahap yang ditetapkan untuk tampilan ini.
 */
export function WorkStepper({ current, cancelled, hasEverRequestedRevision }: { current: WorkStage; cancelled?: boolean; hasEverRequestedRevision: boolean }) {
  if (cancelled) return null;
  const visualCurrent = current === "done" ? "approved" : current;
  const currentIndex = WORK_STAGES.indexOf(visualCurrent);
  const finished = current === "done";

  return (
    <ol className="flex flex-col gap-0 md:flex-row md:items-start md:gap-0" aria-label="Tahap pekerjaan">
      {WORK_STAGES.filter((s) => s !== "done").map((stage, i) => {
        // Tahap revisi dilewati (bukan "sudah selesai") bila pekerjaan ini TIDAK PERNAH direvisi —
        // mencegah dua tahap yang tidak pernah terjadi ditandai seolah sudah dilalui.
        const applicable = !REVISION_ONLY_STAGES.has(stage) || hasEverRequestedRevision;
        const isRevision = REVISION_ONLY_STAGES.has(stage);
        const done = (i < currentIndex || (i === currentIndex && finished)) && applicable;
        const active = i === currentIndex && !finished;
        const upcoming = !done && !active;
        const Icon = STAGE_ICON[stage];
        const last = i === WORK_STAGES.length - 2; // -2: "done" sudah difilter dari daftar

        return (
          <li key={stage} className="relative flex flex-1 md:flex-col">
            {/* Garis penghubung: vertikal di mobile (di kiri, membentang penuh tinggi item), horizontal di
                desktop (melewati tengah ikon). Diposisikan presisi lewat ukuran ikon tetap (size-8 = 2rem). */}
            {!last && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute transition-colors duration-300",
                  // mobile: garis vertikal di kiri, dari tengah ikon ini sampai tengah ikon berikutnya
                  "top-8 left-[15px] h-[calc(100%-1rem)] w-px",
                  // desktop: garis horizontal melewati tengah baris ikon
                  "md:top-4 md:left-[calc(50%+20px)] md:h-px md:w-[calc(100%-40px)]",
                  done ? "bg-accent" : "bg-line",
                )}
              />
            )}
            <div className="flex items-center gap-3 pb-6 md:flex-col md:items-center md:gap-2 md:pb-0 md:text-center">
              <span
                title={`${WORK_STAGE_LABEL[stage]} — ${STAGE_HINT[stage]}`}
                tabIndex={0}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 motion-reduce:transition-none",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  done && !isRevision && "border-accent bg-accent text-white",
                  done && isRevision && "border-warn bg-warn text-white",
                  active && !isRevision && "border-accent bg-accent-soft text-accent ring-4 ring-accent-ring/30",
                  active && isRevision && "border-warn bg-warn-soft text-warn ring-4 ring-warn/20",
                  upcoming && "border-line bg-surface text-ink-3",
                )}
              >
                {done ? <Check className="size-4" aria-hidden="true" /> : <Icon className={cn("size-4", active && stage === "in_progress" && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />}
              </span>
              <span className="flex flex-col md:items-center">
                <span
                  className={cn(
                    "text-[13px] leading-tight font-medium whitespace-nowrap transition-colors duration-300",
                    active && !isRevision && "text-accent",
                    active && isRevision && "text-warn",
                    done && "text-ink",
                    upcoming && "text-ink-3",
                  )}
                >
                  {WORK_STAGE_LABEL[stage]}
                </span>
                {active && <span className="text-[11px] text-ink-3 md:max-w-28">{STAGE_HINT[stage]}</span>}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
