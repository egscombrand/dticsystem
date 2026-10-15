"use client";

import { AlertCircle, CheckCircle2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PicPanelDialog } from "@/components/assignments/pic-panel-dialog";
import { Button } from "@/components/ui/button";
import type { Assignee, MemberOption } from "@/lib/types";
import type { MemberWorkload } from "@/lib/workload";

type Status = { kind: "idle" } | { kind: "saved"; text: string } | { kind: "error"; text: string };

/**
 * Field "Member DTIC yang Ditugaskan (PIC)" di detail pekerjaan. Perubahan dilakukan lewat panel
 * "Kelola PIC" (PicPanelDialog) untuk Manager & Super Admin; tidak ada penyimpanan otomatis.
 */
export function AssignmentField({
  orderId,
  assignees,
  members,
  canAssign = false,
  workloads = [],
}: {
  orderId: string;
  assignees: Assignee[];
  /** Anggota aktif dari tim kategori pekerjaan (sudah difilter server). */
  members: MemberOption[];
  canAssign?: boolean;
  /** Workload aktual kandidat (dari database). Hanya informasi; tidak mengubah PIC. */
  workloads?: MemberWorkload[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // PIC terbaru dari respons server setelah simpan, agar panel tidak menampilkan data lama sebelum refresh selesai.
  const [saved, setSaved] = useState<Assignee[] | null>(null);
  useEffect(() => setSaved(null), [assignees]);
  const shown = saved ?? assignees;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-medium text-ink">Member DTIC yang Ditugaskan (PIC)</p>
      <ul className="flex flex-col gap-1.5" aria-label="Member yang ditugaskan">
        {assignees.length === 0 && <li className="text-sm text-warn">Belum ada PIC</li>}
        {assignees.map((a) => (
          <li key={a.id} className="text-sm text-ink">
            {a.name} <span className="text-ink-3">— {a.division}</span>
          </li>
        ))}
      </ul>
      {canAssign && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)} disabled={members.length === 0}>
            Kelola PIC
          </Button>
          {members.length === 0 && <span className="text-[12.5px] text-ink-3">Tidak ada anggota tim untuk pekerjaan ini.</span>}
        </div>
      )}
      <p className="text-[12.5px] text-ink-3">
        {canAssign ? "Perubahan PIC wajib disertai alasan dan tercatat di riwayat." : "Penugasan PIC diubah oleh Manager atau Super Admin."}
      </p>
      <p aria-live="polite" className="min-h-5 text-[12.5px]">
        {status.kind === "saved" && (
          <span className="inline-flex items-center gap-1.5 text-ok">
            <CheckCircle2 className="size-3.5" aria-hidden="true" /> {status.text}
          </span>
        )}
        {status.kind === "error" && (
          <span role="alert" className="inline-flex items-center gap-1.5 text-bad">
            <AlertCircle className="size-3.5" aria-hidden="true" /> {status.text}
          </span>
        )}
      </p>
      {canAssign && (
        <PicPanelDialog
          orderId={orderId}
          orderLabel="Pekerjaan ini"
          open={open}
          onClose={() => setOpen(false)}
          assignees={shown}
          members={members}
          workloads={workloads}
          onSaved={(text, ids) => {
            const pool = [...assignees, ...members.map((m) => ({ id: m.id, name: m.name, division: m.division, isActive: m.isActive }))];
            setSaved(ids.map((id) => pool.find((a) => a.id === id)).filter((a): a is Assignee => Boolean(a)));
            setOpen(false);
            setStatus({ kind: "saved", text });
            router.refresh(); // perbarui detail, riwayat, dan daftar dari server
          }}
        />
      )}
    </div>
  );
}
