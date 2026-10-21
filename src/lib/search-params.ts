import { addDaysToKey, dateKeyToUtcStart, isDateKey } from "@/lib/dates";
import { QC_STATUSES, type QcStatus } from "@/lib/qc";
import { isOrderStatus } from "@/lib/status";
import type { OrderStatus } from "@/lib/status";

export type RawSearchParams = Record<string, string | string[] | undefined>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function first(sp: RawSearchParams, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export function uuidParam(sp: RawSearchParams, key: string): string | undefined {
  const v = first(sp, key);
  return v && UUID_RE.test(v) ? v : undefined;
}

export function statusParam(sp: RawSearchParams, key = "status"): OrderStatus | undefined {
  const v = first(sp, key);
  return isOrderStatus(v) ? v : undefined;
}

/** Satu status atau beberapa dipisah koma (mis. "review,revision"). */
export function statusListParam(sp: RawSearchParams, key = "status"): OrderStatus[] | undefined {
  const v = first(sp, key);
  if (!v) return undefined;
  const list = [...new Set(v.split(",").map((s) => s.trim()))].filter(isOrderStatus);
  return list.length > 0 ? list : undefined;
}

/** Kode level prioritas (divalidasi formatnya; keberadaan dicek oleh query). */
export function priorityParam(sp: RawSearchParams, key = "priority"): string | undefined {
  const v = first(sp, key);
  return v && /^[a-z][a-z0-9_]{1,29}$/.test(v) ? v : undefined;
}

export function qcStatusParam(sp: RawSearchParams, key = "qc"): QcStatus | undefined {
  const v = first(sp, key);
  return (QC_STATUSES as readonly string[]).includes(v ?? "") ? (v as QcStatus) : undefined;
}

export function enumParam<T extends string>(sp: RawSearchParams, key: string, values: readonly T[]): T | undefined {
  const v = first(sp, key);
  return v && (values as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function pageParam(sp: RawSearchParams): number {
  const n = Number(first(sp, "page"));
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : 1;
}

export function textParam(sp: RawSearchParams, key: string, max = 100): string | undefined {
  const v = first(sp, key)?.trim();
  return v ? v.slice(0, max) : undefined;
}

/** Filter PIC: id member (uuid) atau "none" (belum ditugaskan). */
export function assigneeParam(sp: RawSearchParams, key = "pic"): string | undefined {
  const v = first(sp, key);
  return v === "none" || (v && UUID_RE.test(v)) ? v : undefined;
}

/** Rentang tanggal "YYYY-MM-DD" inklusif → [from, to) dalam UTC. */
export function dateRangeParams(sp: RawSearchParams) {
  const fromKey = first(sp, "from");
  const toKey = first(sp, "to");
  const validFrom = isDateKey(fromKey) ? fromKey : undefined;
  const validTo = isDateKey(toKey) ? toKey : undefined;
  return {
    fromKey: validFrom,
    toKey: validTo,
    from: validFrom ? dateKeyToUtcStart(validFrom)! : undefined,
    to: validTo ? dateKeyToUtcStart(addDaysToKey(validTo, 1))! : undefined,
  };
}

/** Bangun query string dari objek, mengabaikan nilai kosong. */
export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}
