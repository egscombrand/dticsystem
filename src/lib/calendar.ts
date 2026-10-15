/**
 * Periode kalender (murni, tanpa database). Semua hitungan memakai kunci tanggal WIB (YYYY-MM-DD).
 * Minggu dimulai Senin. Deadline adalah satu-satunya tanggal pekerjaan: tidak ada tanggal mulai atau durasi
 * yang diarang di sini.
 */
import { addDaysToKey, daysInMonth, isDateKey, monthKey, parseMonthKey, shiftMonth, toDateKey, weekdayMondayFirst } from "@/lib/dates";

export const CALENDAR_VIEWS = ["month", "week", "day", "list"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];
export const CALENDAR_SORTS = ["deadline", "status", "pic", "title"] as const;
export type CalendarSort = (typeof CALENDAR_SORTS)[number];

export type CalendarPeriod = {
  view: CalendarView;
  /** Tanggal pertama periode (inklusif). */
  fromKey: string;
  /** Tanggal setelah periode (eksklusif). */
  toKey: string;
  /** Tanggal jangkar yang dipakai navigasi (hari, Senin minggu, atau tanggal 1 bulan). */
  anchorKey: string;
  prevKey: string;
  nextKey: string;
  /** Jumlah hari dalam periode. */
  days: number;
};

const shift = (key: string, days: number) => addDaysToKey(key, days);

/** Senin pada minggu yang memuat `key`. */
export function mondayOf(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return shift(key, -weekdayMondayFirst(y, m, d));
}

/** Periode untuk tampilan tertentu dari tanggal jangkar (WIB). */
export function calendarPeriod(view: CalendarView, anchorKey: string): CalendarPeriod {
  if (view === "day") {
    return { view, fromKey: anchorKey, toKey: shift(anchorKey, 1), anchorKey, prevKey: shift(anchorKey, -1), nextKey: shift(anchorKey, 1), days: 1 };
  }
  if (view === "week") {
    const monday = mondayOf(anchorKey);
    return { view, fromKey: monday, toKey: shift(monday, 7), anchorKey: monday, prevKey: shift(monday, -7), nextKey: shift(monday, 7), days: 7 };
  }
  // month & list: satu bulan kalender.
  const [y, m] = anchorKey.split("-").map(Number);
  const first = `${monthKey(y, m)}-01`;
  const next = shiftMonth(y, m, 1);
  const prev = shiftMonth(y, m, -1);
  const nextFirst = `${monthKey(next.year, next.month)}-01`;
  return {
    view,
    fromKey: first,
    toKey: nextFirst,
    anchorKey: first,
    prevKey: `${monthKey(prev.year, prev.month)}-01`,
    nextKey: nextFirst,
    days: daysInMonth(y, m),
  };
}

/** Parameter `date` dari URL; `month=YYYY-MM` tetap didukung untuk tautan lama. Tidak valid → hari ini. */
export function anchorFromParams(dateParam: unknown, monthParam: unknown, todayKey: string): string {
  if (isDateKey(dateParam)) return dateParam;
  const ym = parseMonthKey(monthParam);
  if (ym) return `${monthKey(ym.year, ym.month)}-01`;
  return todayKey;
}

export function viewFromParam(value: unknown): CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(String(value)) ? (value as CalendarView) : "month";
}

export function sortFromParam(value: unknown): CalendarSort {
  return (CALENDAR_SORTS as readonly string[]).includes(String(value)) ? (value as CalendarSort) : "deadline";
}

/** Tanggal kunci WIB dari sebuah timestamp (dipakai untuk mengelompokkan pekerjaan per hari). */
export const dayKeyOf = (iso: string | Date) => toDateKey(iso);
