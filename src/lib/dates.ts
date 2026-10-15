import { APP_LOCALE, APP_TIMEZONE } from "@/lib/config/app";

/**
 * Utilitas tanggal yang konsisten terhadap zona waktu.
 * Database menyimpan timestamptz (UTC). Input & tampilan memakai APP_TIMEZONE
 * agar deadline tidak bergeser tanggal di server/klien yang zonanya berbeda.
 */

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

export function getZonedParts(date: Date, timeZone: string = APP_TIMEZONE): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-15T14:30" (waktu dinding di APP_TIMEZONE) → Date UTC. Mengembalikan null jika tidak valid. */
export function zonedLocalToUtc(value: string, timeZone: string = APP_TIMEZONE): Date | null {
  const m = LOCAL_DATETIME_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  // Validasi tanggal kalender (mis. 31 Februari)
  const check = new Date(guess);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  let result = guess - offsetMs(new Date(guess), timeZone);
  // Koreksi kedua untuk zona dengan DST
  const second = guess - offsetMs(new Date(result), timeZone);
  if (second !== result) result = second;
  return new Date(result);
}

/** "YYYY-MM-DD" → awal hari tersebut (00:00 di APP_TIMEZONE) dalam UTC. */
export function dateKeyToUtcStart(key: string, timeZone: string = APP_TIMEZONE): Date | null {
  if (!DATE_KEY_RE.test(key)) return null;
  return zonedLocalToUtc(`${key}T00:00`, timeZone);
}

/** Jam penyimpanan deadline yang dipilih sebagai tanggal saja: akhir hari kerja penuh (23.59 WIB). */
export const DATE_ONLY_DEADLINE_TIME = "23:59";

/** "YYYY-MM-DD" → deadline 23.59 WIB pada tanggal tersebut (UTC). Null bila tidak valid. */
export function dateOnlyDeadlineToUtc(key: string, timeZone: string = APP_TIMEZONE): Date | null {
  if (!DATE_KEY_RE.test(key)) return null;
  return zonedLocalToUtc(`${key}T${DATE_ONLY_DEADLINE_TIME}`, timeZone);
}

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && DATE_KEY_RE.test(value) && dateKeyToUtcStart(value) !== null;
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** Date → "YYYY-MM-DD" menurut APP_TIMEZONE. */
export function toDateKey(date: Date | string, timeZone: string = APP_TIMEZONE): string {
  const p = getZonedParts(new Date(date), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Date → nilai untuk <input type="datetime-local"> di APP_TIMEZONE. */
export function toDateTimeLocalValue(date: Date | string, timeZone: string = APP_TIMEZONE): string {
  const p = getZonedParts(new Date(date), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Tambah n hari pada "YYYY-MM-DD" (aritmetika kalender murni). */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

export function parseMonthKey(value: unknown): { year: number; month: number } | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  return { year, month };
}

export function shiftMonth(year: number, month: number, delta: number) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** Jumlah hari dalam bulan (month 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Hari dalam minggu (0 = Senin … 6 = Minggu) untuk tanggal kalender. */
export function weekdayMondayFirst(year: number, month: number, day: number): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

const dateFmt = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIMEZONE, day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIMEZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const weekdayDateFmt = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const monthFmt = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: "UTC", month: "long", year: "numeric" });

export function formatDate(date: Date | string): string {
  return dateFmt.format(new Date(date));
}

export function formatDateTime(date: Date | string): string {
  return `${dateTimeFmt.format(new Date(date))} WIB`;
}

/** Deadline yang dipilih sebagai tanggal saja (23.59 WIB) ditampilkan tanpa jam. */
export function formatDeadline(date: Date | string): string {
  const p = getZonedParts(new Date(date));
  return p.hour === 23 && p.minute === 59 ? formatDate(date) : formatDateTime(date);
}

/** Contoh: "Kamis, 15 Oktober 2026". */
export function formatLongDate(date: Date | string): string {
  return weekdayDateFmt.format(new Date(date));
}

export function formatMonthLabel(year: number, month: number): string {
  return monthFmt.format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Teks ringkas sisa waktu deadline, contoh: "2 hari lagi", "Terlambat 3 jam". */
export function describeDeadline(deadline: Date | string, now: Date = new Date()): string {
  const diff = new Date(deadline).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let span: string;
  if (minutes < 60) span = `${Math.max(minutes, 1)} menit`;
  else if (hours < 48) span = `${hours} jam`;
  else span = `${days} hari`;
  return diff >= 0 ? `${span} lagi` : `Lewat ${span}`;
}

/** Selisih hari antara dua kunci tanggal WIB (to − from). Murni berbasis kalender, tanpa pengaruh zona browser. */
export function daysBetweenKeys(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/** Kunci tanggal WIB (YYYY-MM-DD) untuk setiap hari dari `from` (inklusif) sampai `to` (eksklusif). */
export function dayKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });
  for (let t = from.getTime(); t < to.getTime(); t += 24 * 3600_000) keys.push(fmt.format(new Date(t)));
  return keys;
}
