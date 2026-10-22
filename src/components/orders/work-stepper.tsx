import { Check, CheckCircle2, ClipboardCheck, Clock, FileEdit, LoaderCircle, type LucideIcon, RefreshCw, RotateCcw } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { RequesterDecision } from "@/lib/qc";
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

// Hint TIDAK menyebut "Manager" secara khusus untuk tahap yang berlaku di KEDUA jalur QC (langsung ke
// pemohon ATAU lewat Manager, pilihan PIC per pengajuan) — hanya "approved" yang Manager-spesifik, karena
// tahap aktif ini hanya tercapai lewat qc_status='approved', yang HANYA diisi oleh persetujuan Manager
// (Jalur A tanpa Manager langsung mencapai "done", tidak pernah singgah di sini — lihat deriveWorkStage).
const STAGE_HINT: Record<Exclude<WorkStage, "done">, string> = {
  waiting_start: "Belum ada yang mulai mengerjakan.",
  in_progress: "PIC sedang mengerjakan.",
  draft_result: "Ada draf hasil tersimpan, belum diajukan QC.",
  pending_review: "Menunggu pemeriksaan pertama — Manager atau pemohon, sesuai jalur yang dipilih PIC.",
  needs_revision: "Revisi diminta — PIC perlu menindaklanjuti.",
  pending_rereview: "Hasil revisi menunggu diperiksa ulang.",
  // Default sebelum ada delivery_recorded sama sekali — lihat REQUESTER_DECISION_HINT untuk 2 keadaan
  // lanjutan (sudah diajukan, menunggu keputusan / pemohon sudah menyetujui) yang menimpa teks ini.
  approved: "Disetujui Manager — menunggu diajukan ke pemohon.",
};

/** Menimpa STAGE_HINT["approved"] begitu ada riwayat pengajuan ke pemohon — satu status "approved" di
 *  stepper ini mencakup 3 keadaan nyata berbeda (lihat RequesterDecision di qc.ts), teks HARUS ikut
 *  riwayat peristiwa yang sama dipakai tombol, bukan statis seperti sebelumnya. */
const REQUESTER_DECISION_HINT: Record<RequesterDecision, string | null> = {
  none: null,
  awaiting: "Sudah diajukan ke pemohon — menunggu keputusan (setuju/revisi).",
  // Tidak pernah benar-benar dibaca untuk tahap "approved" (revisi memindahkan current ke "needs_revision"
  // — lihat deriveWorkStage), disertakan hanya demi kelengkapan tipe RequesterDecision.
  revision_requested: null,
  approved: "Pemohon sudah menyetujui — lanjutkan ke penyelesaian pekerjaan.",
};

/**
 * Ringkasan visual tahap pekerjaan saat ini — riwayat lengkap (pelaku, waktu, catatan, dan setiap siklus
 * revisi bila lebih dari satu kali) tetap di ActivityTimeline, bukan di sini. "done" (pekerjaan selesai)
 * divisualkan sebagai seluruh tahap tercapai, berhenti di "Disetujui" (lihat "finished" di bawah) — node
 * yang sama ("Disetujui") membedakan DUA keadaan lewat gaya visual, bukan teks: cincin aktif = Manager baru
 * menyetujui (qc_status approved, order BELUM selesai — masih menunggu pemohon), centang penuh = pemohon
 * sendiri yang sudah menyetujui (order benar-benar completed) — ACC Manager TIDAK PERNAH disamakan dengan
 * persetujuan akhir pemohon.
 *
 * "Perlu Revisi" & "Menunggu Pemeriksaan Ulang" HANYA dirender sebagai node bila revisi benar-benar pernah
 * terjadi (hasEverRequestedRevision) — bukan sekadar ditandai "belum selesai": pekerjaan yang tidak pernah
 * direvisi tidak pernah menampilkan kedua tahap ini sama sekali, supaya timeline tidak terlihat seolah
 * setiap pekerjaan wajib melalui revisi.
 */
export function WorkStepper({
  current,
  cancelled,
  hasEverRequestedRevision,
  revisionCount = 0,
  requesterDecision = "none",
}: {
  current: WorkStage;
  cancelled?: boolean;
  hasEverRequestedRevision: boolean;
  /** Jumlah siklus revisi (lintas jalur QC) — ditampilkan sebagai "Revisi ke-N" bila lebih dari satu. */
  revisionCount?: number;
  /** Hanya relevan saat current === "approved"/"done" — lihat REQUESTER_DECISION_HINT. */
  requesterDecision?: RequesterDecision;
}) {
  if (cancelled) return null;
  const visualCurrent = current === "done" ? "approved" : current;
  const finished = current === "done";
  // Tahap revisi disertakan HANYA bila pernah terjadi — bukan direndam jadi node "belum tercapai".
  const isRenderable = (s: WorkStage): s is Exclude<WorkStage, "done"> => s !== "done" && (!REVISION_ONLY_STAGES.has(s) || hasEverRequestedRevision);
  const stages = WORK_STAGES.filter(isRenderable);
  const currentIndex = stages.indexOf(visualCurrent);

  return (
    <ol className="flex flex-col gap-0 md:flex-row md:items-start md:gap-0" aria-label="Tahap pekerjaan">
      {stages.map((stage, i) => {
        const isRevision = REVISION_ONLY_STAGES.has(stage);
        const done = i < currentIndex || (i === currentIndex && finished);
        const active = i === currentIndex && !finished;
        const upcoming = !done && !active;
        const Icon = STAGE_ICON[stage];
        const last = i === stages.length - 1;
        const hint =
          stage === "needs_revision" && revisionCount > 1
            ? `${STAGE_HINT[stage]} (revisi ke-${revisionCount})`
            : stage === "approved"
              ? REQUESTER_DECISION_HINT[requesterDecision] ?? STAGE_HINT[stage]
              : STAGE_HINT[stage];

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
                title={`${WORK_STAGE_LABEL[stage]} — ${hint}`}
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
                    // Nowrap di mobile (lebar penuh tersedia, satu baris cukup); di desktop label BOLEH
                    // melipat 2 baris dalam kolom terbatas — mencegah label panjang bertabrakan dengan
                    // kolom tetangga (lihat kolom-kolom berbagi lebar yang sama).
                    "text-[13px] leading-tight font-medium whitespace-nowrap transition-colors duration-300 md:w-20 md:text-center md:break-words md:whitespace-normal",
                    active && !isRevision && "text-accent",
                    active && isRevision && "text-warn",
                    done && "text-ink",
                    upcoming && "text-ink-3",
                  )}
                >
                  {WORK_STAGE_LABEL[stage]}
                </span>
                {active && <span className="text-[11px] text-ink-3 md:w-28 md:text-center">{hint}</span>}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
