"use client";

import { BellRing, X } from "lucide-react";
import { useEffect, useState } from "react";
import { collabGet, forgetMyRequest, loadMyRequests } from "@/lib/client/collab-api";
import { badgeLabels, badgeTotal, type OrderBadges } from "@/lib/collab";

const BADGE_POLL_MS = 45_000;

/** Daftar "Request saya": nomor order yang pernah dicari/dikirim dari browser ini, dengan penanda perhatian. */
export function MyRequests({ onOpen }: { onOpen: (orderNumber: string) => void }) {
  const [list, setList] = useState<string[] | null>(null);
  const [badges, setBadges] = useState<Record<string, OrderBadges>>({});

  useEffect(() => {
    const t = window.setTimeout(() => setList(loadMyRequests()), 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!list || list.length === 0) return;
    let stopped = false;
    let timer: number | undefined;
    async function tick() {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const res = await collabGet<{ badges: OrderBadges[] }>(`/api/public/tracking/badges?orders=${encodeURIComponent(list!.join(","))}`);
          if (!stopped) setBadges(Object.fromEntries(res.badges.map((b) => [b.orderNumber, b])));
        } catch {
          // penanda hanya pelengkap; gagal diam-diam
        }
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), BADGE_POLL_MS);
    }
    timer = window.setTimeout(() => void tick(), 0);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [list]);

  if (!list || list.length === 0) return null;
  return (
    <section className="mx-auto mt-6 max-w-xl rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="my-requests-title" data-testid="my-requests">
      <h2 id="my-requests-title" className="text-[15px] font-semibold text-navy">Request saya</h2>
      <p className="mt-1 text-[12.5px] text-ink-3">Nomor order yang pernah Anda buka di perangkat ini.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {list.map((n) => {
          const b = badges[n];
          const total = b ? badgeTotal(b) : 0;
          return (
            <li key={n} className="flex items-center gap-2" data-testid="my-request" data-order={n}>
              <button type="button" onClick={() => onOpen(n)} className="flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-line px-3 py-2 text-left hover:border-teal/50 hover:bg-subtle/60">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[13.5px] font-semibold text-navy">{n}</span>
                  {total > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-bad px-2 py-0.5 text-[11px] font-bold text-white" data-testid="my-request-badge" aria-label={`${total} perlu perhatian`}>
                      <BellRing className="size-3" aria-hidden="true" /> {total}
                    </span>
                  )}
                </span>
                {b && badgeLabels(b).length > 0 && <span className="text-[12px] text-ink-2" data-testid="my-request-labels">{badgeLabels(b).join(" · ")}</span>}
              </button>
              <button type="button" aria-label={`Hapus ${n} dari daftar`} title="Hapus dari daftar" onClick={() => setList(forgetMyRequest(n))} className="rounded-lg p-2 text-ink-3 hover:bg-subtle hover:text-ink">
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
