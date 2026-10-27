"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, FilePlus2, LayoutDashboard, ListChecks, MessageCircleQuestion, PlayCircle, Search, ShieldCheck, SquareStack, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Tutorial, TutorialIcon } from "@/lib/tutorials";
import { getTutorialProgress, type TutorialStatus } from "@/lib/client/tutorial-progress";
import { useTutorial } from "@/components/tutorial/tutorial-context";

const ICONS: Record<TutorialIcon, typeof LayoutDashboard> = {
  LayoutDashboard,
  FilePlus2,
  Search,
  CheckCircle2,
  MessageCircleQuestion,
  ListChecks,
  ShieldCheck,
  Users,
};

const STATUS_LABEL: Record<TutorialStatus, string> = { not_started: "Belum Dimulai", in_progress: "Sedang Dipelajari", completed: "Selesai" };
const STATUS_TONE: Record<TutorialStatus, "neutral" | "accent" | "success"> = { not_started: "neutral", in_progress: "accent", completed: "success" };

/** Progres dibaca dari localStorage HANYA setelah mount agar render pertama server/klien tetap sama (tidak ada akun pemohon untuk menyimpannya di server — lihat tutorial-progress.ts). */
export function TutorialCard({ tutorial }: { tutorial: Tutorial }) {
  const { startTutorial, namespace } = useTutorial();
  const [status, setStatus] = useState<TutorialStatus>("not_started");
  const [stepIndex, setStepIndex] = useState(0);
  const Icon = ICONS[tutorial.icon];

  useEffect(() => {
    const sync = () => {
      const p = getTutorialProgress(tutorial.id, namespace);
      setStatus(p.status);
      setStepIndex(p.stepIndex);
    };
    sync();
  }, [tutorial.id, namespace]);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <Badge tone={STATUS_TONE[status]} dot>
          {STATUS_LABEL[status]}
        </Badge>
      </div>
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{tutorial.title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{tutorial.description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
        <p className="flex items-center gap-1.5">
          <Clock3 className="size-3.5" aria-hidden="true" /> Sekitar {tutorial.estimatedMinutes} menit
        </p>
        <p className="flex items-center gap-1.5">
          <SquareStack className="size-3.5" aria-hidden="true" /> {tutorial.steps.length} langkah
        </p>
      </div>
      <div className="mt-auto flex items-center gap-3">
        <Button
          size="sm"
          variant={status === "not_started" ? "primary" : "secondary"}
          onClick={() => startTutorial(tutorial.id, status === "in_progress" ? stepIndex : 0)}
          icon={<PlayCircle className="size-4" aria-hidden="true" />}
        >
          {status === "not_started" ? "Mulai Tutorial" : status === "completed" ? "Ulangi Tutorial" : "Lanjutkan Tutorial"}
        </Button>
        {status === "in_progress" && (
          <button type="button" onClick={() => startTutorial(tutorial.id, 0)} className="text-xs font-medium text-ink-3 hover:text-ink hover:underline">
            Mulai dari Awal
          </button>
        )}
      </div>
    </Card>
  );
}
