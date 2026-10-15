"use client";

import { ChevronRight, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PicPanelDialog } from "@/components/assignments/pic-panel-dialog";
import { AssigneeList } from "@/components/assignments/assignee-list";
import { DeadlineText } from "@/components/orders/deadline-text";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import type { MemberOption, OrderListItem } from "@/lib/types";
import type { MemberWorkload } from "@/lib/workload";

export type DistribusiRow = Pick<OrderListItem, "id" | "orderNumber" | "title" | "status" | "deadlineAt" | "teamId" | "teamName" | "assignees">;

/**
 * Daftar pekerjaan untuk Distribusi Pekerjaan. Setiap baris membuka panel "Kelola PIC" yang sama dengan detail
 * pekerjaan, sehingga aturan tim, alasan, konfirmasi, dan audit berlaku sama. Tidak ada perubahan otomatis.
 */
export function DistribusiList({
  rows,
  membersByTeam,
  workloads,
  now,
}: {
  rows: DistribusiRow[];
  membersByTeam: Record<string, MemberOption[]>;
  workloads: MemberWorkload[];
  now: string;
}) {
  const router = useRouter();
  const [active, setActive] = useState<DistribusiRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const nowDate = new Date(now);
  const activeMembers: MemberOption[] = active?.teamId ? (membersByTeam[active.teamId] ?? []) : [];

  return (
    <>
      {notice && (
        <p role="status" className="mb-3 rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok">
          {notice}
        </p>
      )}
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5" data-testid="distribusi-row" data-order={r.orderNumber}>
            <Link href={`/dtic/orders/${r.id}`} className="min-w-0 flex-1 rounded focus-visible:outline-offset-4">
              <span className="block truncate text-sm font-medium text-ink hover:text-accent">{r.title}</span>
              <span className="mt-0.5 block font-mono text-xs text-ink-3">
                {r.orderNumber}
                {r.teamName ? ` · ${r.teamName}` : ""}
              </span>
            </Link>
            <div className="min-w-0 sm:w-[210px]">
              <AssigneeList assignees={r.assignees} names />
            </div>
            <div className="flex items-center gap-3 sm:w-[200px]">
              <StatusBadge status={r.status} />
              <DeadlineText deadlineAt={r.deadlineAt} status={r.status} now={nowDate} compact />
            </div>
            <div className="flex items-center gap-1.5 sm:justify-end">
              <Button
                variant="secondary"
                size="sm"
                icon={<UserPlus className="size-4" />}
                disabled={!r.teamId || (membersByTeam[r.teamId] ?? []).length === 0}
                onClick={() => {
                  setNotice(null);
                  setActive(r);
                }}
              >
                Atur PIC
              </Button>
              <Link
                href={`/dtic/orders/${r.id}`}
                aria-label={`Buka detail ${r.orderNumber}`}
                className="inline-flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-subtle hover:text-accent"
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {active && (
        <PicPanelDialog
          orderId={active.id}
          orderLabel={`${active.orderNumber} · ${active.title}`}
          open
          onClose={() => setActive(null)}
          assignees={active.assignees}
          members={activeMembers}
          workloads={workloads}
          onSaved={(text) => {
            setNotice(`${active.orderNumber}: ${text}`);
            setActive(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
