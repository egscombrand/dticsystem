"use client";

import { CalendarClock, GripVertical } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { AssigneeList } from "@/components/assignments/assignee-list";
import { OverdueBadge, PriorityBadge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { internalRequest } from "@/lib/client/api";
import { formatDeadline } from "@/lib/dates";
import { isOverdue, ORDER_STATUSES, STATUS_META, type OrderStatus } from "@/lib/status";
import type { OrderListItem } from "@/lib/types";

const DOT: Record<string, string> = {
  neutral: "bg-ink-3",
  accent: "bg-accent",
  info: "bg-info",
  warning: "bg-warn",
  success: "bg-ok",
  danger: "bg-bad",
  muted: "bg-[#9aa1ad]",
};

/** canMove=false (Manager): papan hanya memantau; drag & pilihan status dinonaktifkan. Server tetap menolak. */
export function KanbanBoard({ initialOrders, nowIso, canMove }: { initialOrders: OrderListItem[]; nowIso: string; canMove: boolean }) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<OrderStatus | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [source, setSource] = useState(initialOrders);
  const now = new Date(nowIso);

  // Data server baru (router.refresh / filter) menggantikan state lokal.
  if (source !== initialOrders) {
    setSource(initialOrders);
    setOrders(initialOrders);
  }

  async function move(id: string, status: OrderStatus) {
    const order = orders.find((o) => o.id === id);
    if (!order || order.status === status || savingId) return;
    const previous = order.status;
    setSavingId(id);
    setNotice(null);
    setOrders((list) => list.map((o) => (o.id === id ? { ...o, status } : o)));
    try {
      await internalRequest(`/api/internal/orders/${id}/status`, "POST", { status });
      setNotice({ kind: "success", text: `${order.orderNumber} dipindahkan ke ${STATUS_META[status].label}.` });
      router.refresh();
    } catch (err) {
      setOrders((list) => list.map((o) => (o.id === id ? { ...o, status: previous } : o)));
      setNotice({ kind: "error", text: `Gagal memindahkan ${order.orderNumber}: ${err instanceof Error ? err.message : "kesalahan tidak diketahui"}` });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <div aria-live="polite" className="mb-4 empty:hidden">
        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      </div>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        <div className="flex snap-x gap-4">
          {ORDER_STATUSES.map((status) => {
            const items = orders.filter((o) => o.status === status);
            const meta = STATUS_META[status];
            return (
              <section
                key={status}
                aria-label={`${meta.label}, ${items.length} order`}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  setOverCol(status);
                }}
                onDragLeave={() => setOverCol((c) => (c === status ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragId;
                  setOverCol(null);
                  setDragId(null);
                  if (id) void move(id, status);
                }}
                className={cn(
                  "flex w-[280px] shrink-0 snap-start flex-col rounded-xl border bg-[#f1f3f5]/70 transition-colors",
                  overCol === status ? "border-accent bg-accent-soft/50" : "border-line",
                )}
              >
                <header className="flex items-center justify-between px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", DOT[meta.tone])} aria-hidden="true" />
                    <h2 className="text-[13px] font-semibold text-ink">{meta.label}</h2>
                  </div>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-2 ring-1 ring-line tabular-nums">{items.length}</span>
                </header>
                <ul className="flex min-h-24 flex-col gap-2.5 px-2.5 pb-3">
                  {items.length === 0 && (
                    <li className="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-xs text-ink-3">Tidak ada order</li>
                  )}
                  {items.map((o) => {
                    const late = isOverdue(o.deadlineAt, o.status, now);
                    return (
                      <li
                        key={o.id}
                        draggable={canMove && !savingId}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", o.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragId(o.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverCol(null);
                        }}
                        className={cn(
                          "group rounded-lg border border-line bg-surface p-3 shadow-card transition",
                          dragId === o.id && "opacity-50",
                          savingId === o.id && "animate-pulse",
                          late && "border-l-2 border-l-bad",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-mono text-[11.5px] text-ink-3">{o.orderNumber}</span>
                          <GripVertical className="size-4 shrink-0 cursor-grab text-[#b7bcc5] group-hover:text-ink-3" aria-hidden="true" />
                        </div>
                        <Link href={`/dtic/orders/${o.id}`} className="mt-1 block text-sm leading-snug font-medium text-ink hover:text-accent">
                          {o.title}
                        </Link>
                        <p className="mt-1 truncate text-xs text-ink-3">{o.brandName}</p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          <PriorityBadge name={o.priorityName} tone={o.priorityTone} />
                          {late && <OverdueBadge />}
                        </div>
                        <AssigneeList assignees={o.assignees} compact className="mt-2 flex max-w-full" />
                        <p className={cn("mt-1.5 flex items-center gap-1.5 text-xs", late ? "text-bad" : "text-ink-2")}>
                          <CalendarClock className="size-3.5" aria-hidden="true" />
                          {formatDeadline(o.deadlineAt)}
                        </p>
                        {canMove && (
                        <label className="mt-2.5 block">
                          <span className="sr-only">Pindahkan {o.orderNumber} ke status</span>
                          <select
                            value={o.status}
                            disabled={savingId !== null}
                            onChange={(e) => void move(o.id, e.target.value as OrderStatus)}
                            className="h-8 w-full rounded-md border border-line bg-subtle px-2 text-xs text-ink-2 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                          >
                            {ORDER_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s === o.status ? `Status: ${STATUS_META[s].label}` : `Pindah ke ${STATUS_META[s].label}`}
                              </option>
                            ))}
                          </select>
                        </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
