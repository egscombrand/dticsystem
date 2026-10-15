import { ChevronRight } from "lucide-react";
import { OrderRowActions } from "@/components/orders/order-row-actions";
import Link from "next/link";
import { AssigneeList } from "@/components/assignments/assignee-list";
import { DeadlineText } from "@/components/orders/deadline-text";
import { OverdueBadge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { isOverdue } from "@/lib/status";
import type { OrderListItem } from "@/lib/types";

/** superAdmin: tampilkan aksi kirim ulang Telegram & hapus (izin tetap diperiksa di server). */
export function OrderTable({ orders, now, superAdmin = false }: { orders: OrderListItem[]; now: Date; superAdmin?: boolean }) {
  return (
    <>
      {/* Tablet & desktop */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1120px] text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-subtle text-xs font-medium tracking-wide text-ink-3 uppercase">
              <th scope="col" className="px-5 py-3 font-medium">Order</th>
              <th scope="col" className="px-4 py-3 font-medium">Kategori</th>
              <th scope="col" className="px-4 py-3 font-medium">Brand pemohon</th>
              <th scope="col" className="px-4 py-3 font-medium">Pemohon</th>
              <th scope="col" className="px-4 py-3 font-medium">PIC</th>
              <th scope="col" className="px-4 py-3 font-medium">Deadline</th>
              <th scope="col" className="px-4 py-3 font-medium">Prioritas</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Masuk</th>
              <th scope="col" className={superAdmin ? "py-3 pr-4 text-right" : "w-12 py-3 pr-4"}><span className="sr-only">Aksi</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {orders.map((o) => {
              const late = isOverdue(o.deadlineAt, o.status, now);
              return (
                <tr key={o.id} className="group hover:bg-subtle/70">
                  <td className="max-w-[280px] px-5 py-3.5">
                    <Link href={`/dtic/orders/${o.id}`} className="block rounded focus-visible:outline-offset-4">
                      <span className="block truncate font-medium text-ink group-hover:text-accent">{o.title}</span>
                      <span className="mt-0.5 block font-mono text-xs text-ink-3">{o.orderNumber}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-ink-2">{o.teamName ?? <span className="text-ink-3">—</span>}</td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-ink-2">{o.brandName}</td>
                  <td className="max-w-[180px] px-4 py-3.5">
                    <span className="block truncate text-ink">{o.requesterName}</span>
                    <span className="block truncate text-xs text-ink-3">{o.department}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="w-[190px] max-w-[190px]"><AssigneeList assignees={o.assignees} names /></div>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex flex-col items-start gap-1">
                      <DeadlineText deadlineAt={o.deadlineAt} status={o.status} now={now} />
                      {late && <OverdueBadge />}
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><PriorityBadge name={o.priorityName} tone={o.priorityTone} /></td>
                  <td className="px-4 py-3.5"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-[13px] text-ink-3">{formatDate(o.createdAt)}</td>
                  <td className="py-3.5 pr-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {superAdmin && <OrderRowActions orderId={o.id} orderNumber={o.orderNumber} title={o.title} />}
                      <Link
                        href={`/dtic/orders/${o.id}`}
                        className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-ink-2 hover:bg-surface hover:text-accent hover:ring-1 hover:ring-line"
                        aria-label={`Buka detail ${o.orderNumber}`}
                        title="Buka detail"
                      >
                        Detail <ChevronRight className="size-4" aria-hidden="true" />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="divide-y divide-line md:hidden">
        {orders.map((o) => (
          <li key={o.id}>
            <Link href={`/dtic/orders/${o.id}`} className="block px-4 pt-4 pb-3 hover:bg-subtle">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-ink-3">{o.orderNumber}</p>
                  <p className="mt-0.5 text-sm font-medium text-ink">{o.title}</p>
                  <p className="mt-0.5 text-xs text-ink-3">{o.teamName ? `${o.teamName} · ` : ""}{o.brandName} · {o.requesterName}</p>
                </div>
                <StatusBadge status={o.status} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <PriorityBadge name={o.priorityName} tone={o.priorityTone} />
                {isOverdue(o.deadlineAt, o.status, now) && <OverdueBadge />}
                <AssigneeList assignees={o.assignees} names className="max-w-full" />
                <span className="ml-auto"><DeadlineText deadlineAt={o.deadlineAt} status={o.status} now={now} compact /></span>
              </div>
            </Link>
            {superAdmin && (
              <div className="px-4 pb-3">
                <OrderRowActions orderId={o.id} orderNumber={o.orderNumber} title={o.title} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
