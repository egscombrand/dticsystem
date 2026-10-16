"use client";

import { Maximize2, Minimize2, Moon, Play, Sun, Volume2, VolumeX } from "lucide-react";
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { diffDisplay, isNewerResponse, type DisplayEvent } from "@/lib/display-events";
import { formatDeadline } from "@/lib/dates";
import type { DisplayItem, DisplaySnapshot } from "@/lib/server/repositories/display";
import { STATUS_META } from "@/lib/status";

const POLL_MS = 7000;
const MAX_BACKOFF_MS = 60_000;
const PAGE_MS = 12_000;
const PAGE_SIZE = 5;
const TOAST_MS = 9000;
const MAX_TOASTS = 3;
const ENDPOINT = "/api/internal/display/orders";

/* ---------- preferensi lokal (tema & suara) ---------- */
function makeStore(key: string, fallback: string) {
  const listeners = new Set<() => void>();
  return {
    get: () => {
      try {
        return window.localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set: (v: string) => {
      try {
        window.localStorage.setItem(key, v);
      } catch {
        // penyimpanan diblokir: preferensi hanya untuk sesi ini
      }
      listeners.forEach((l) => l());
    },
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => e.key === key && cb();
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}
const themeStore = makeStore("dtic.display.theme", "dark");
const soundStore = makeStore("dtic.display.sound", "off");
const volumeStore = makeStore("dtic.display.volume", "80");
const DEFAULT_VOLUME = 80;
const readVolume = (raw: string) => {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : DEFAULT_VOLUME;
};

/* ---------- jam & fullscreen ---------- */
const clockSubscribe = (cb: () => void) => {
  const id = window.setInterval(cb, 1000);
  return () => window.clearInterval(id);
};
/** Snapshot jam harus stabil di antara pembacaan dalam satu detik (React menolak snapshot yang berubah tiap panggilan). */
let clockSecond = -1;
let clockCached = new Date(0);
const clockSnapshot = () => {
  const sec = Math.floor(Date.now() / 1000);
  if (sec !== clockSecond) {
    clockSecond = sec;
    clockCached = new Date(sec * 1000);
  }
  return clockCached;
};
const clockServer = () => null;
function fsSubscribe(cb: () => void) {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
}
const fsSnapshot = () => Boolean(document.fullscreenElement);
const fsServer = () => false;

/* ---------- tema ---------- */
type Theme = "dark" | "light";
const PALETTE: Record<Theme, { root: string; panel: string; card: string; muted: string; text: string; ring: string; header: string }> = {
  dark: { root: "bg-[#050b16] text-white", panel: "bg-[#0b1220] ring-[#1f2937]", card: "bg-[#111827] ring-[#1f2937]", muted: "text-[#9ca3af]", text: "text-white", ring: "ring-[#1f2937]", header: "bg-[#0b1220]" },
  light: { root: "bg-[#f4f6fa] text-[#111827]", panel: "bg-white ring-[#e5e7eb]", card: "bg-[#f9fafb] ring-[#e5e7eb]", muted: "text-[#4b5563]", text: "text-[#111827]", ring: "ring-[#e5e7eb]", header: "bg-white" },
};

/* ---------- warna status (layar) ---------- */
const STATUS_PILL: Record<DisplayItem["status"], { dark: string; light: string }> = {
  submitted: { dark: "bg-[#374151] text-[#e5e7eb]", light: "bg-[#e5e7eb] text-[#111827]" },
  assigned: { dark: "bg-[#1e3a8a] text-[#bfdbfe]", light: "bg-[#dbeafe] text-[#1e3a8a]" },
  in_progress: { dark: "bg-[#1e40af] text-[#dbeafe]", light: "bg-[#dbeafe] text-[#1e40af]" },
  pending_confirmation: { dark: "bg-[#4c1d95] text-[#ddd6fe]", light: "bg-[#ede9fe] text-[#4c1d95]" },
  internal_revision: { dark: "bg-[#7f1d1d] text-[#fecaca]", light: "bg-[#fee2e2] text-[#7f1d1d]" },
  awaiting_requester: { dark: "bg-[#134e4a] text-[#99f6e4]", light: "bg-[#ccfbf1] text-[#134e4a]" },
  on_hold: { dark: "bg-[#713f12] text-[#fde68a]", light: "bg-[#fef9c3] text-[#713f12]" },
  completed: { dark: "bg-[#064e3b] text-[#a7f3d0]", light: "bg-[#d1fae5] text-[#064e3b]" },
  cancelled: { dark: "bg-[#27272a] text-[#71717a]", light: "bg-[#e4e4e7] text-[#52525b]" },
};
const COLUMN = {
  queue: { label: "ANTREAN", accent: "text-[#3b82f6]", dark: "text-[#60a5fa]", bar: "bg-[#3b82f6]" },
  progress: { label: "SEDANG DIKERJAKAN", accent: "text-[#8b5cf6]", dark: "text-[#c4b5fd]", bar: "bg-[#8b5cf6]" },
  done: { label: "SELESAI / MENUNGGU KONFIRMASI", accent: "text-[#059669]", dark: "text-[#6ee7b7]", bar: "bg-[#10b981]" },
} as const;

const dateLong = (iso: string) => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

/* ---------- suara (Web Audio) ----------
 * Satu AudioContext dibuat dari klik pengguna lalu dipakai ulang (tidak pernah dibuat saat polling).
 * Semua nada lewat satu GainNode master yang diatur slider volume. Pemutaran baru menghentikan yang lama.
 */
type AudioState = "off" | "on" | "blocked";
type SoundKind = "new" | "status";

const ATTACK_S = 0.04;
/** Order baru: 4 nada naik, triangle (lebih lembut daripada square), total ~2,3 detik. */
/** Perubahan status: 2 nada turun, sine, total ~1,2 detik, lebih pelan dari order baru. */
const SOUND_SPEC: Record<SoundKind, { wave: OscillatorType; peak: number; notes: { freq: number; start: number; dur: number }[] }> = {
  new: {
    wave: "triangle",
    peak: 0.3,
    notes: [
      { freq: 523.25, start: 0, dur: 0.5 },
      { freq: 659.25, start: 0.6, dur: 0.5 },
      { freq: 783.99, start: 1.2, dur: 0.5 },
      { freq: 1046.5, start: 1.8, dur: 0.5 },
    ],
  },
  status: {
    wave: "sine",
    peak: 0.18,
    notes: [
      { freq: 659.25, start: 0, dur: 0.55 },
      { freq: 493.88, start: 0.5, dur: 0.7 },
    ],
  },
};
const soundLengthMs = (kind: SoundKind) => Math.round(Math.max(...SOUND_SPEC[kind].notes.map((n) => n.start + n.dur)) * 1000);

function scheduleSound(ctx: AudioContext, out: GainNode, kind: SoundKind, oscs: OscillatorNode[]) {
  const spec = SOUND_SPEC[kind];
  const t0 = ctx.currentTime + 0.02;
  for (const n of spec.notes) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const s = t0 + n.start;
    o.type = spec.wave;
    o.frequency.value = n.freq;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(spec.peak, s + ATTACK_S);
    g.gain.exponentialRampToValueAtTime(0.0001, s + n.dur);
    o.connect(g).connect(out);
    o.start(s);
    o.stop(s + n.dur + 0.02);
    oscs.push(o);
  }
}
function stopOscillators(list: OscillatorNode[]) {
  for (const o of list) {
    try {
      o.stop();
    } catch {
      // sudah berhenti
    }
    o.disconnect();
  }
  list.length = 0;
}

/** Running text: komponen terpisah + memo, jadi render ulang karena polling tidak menyentuh animasinya. */
const TICKER = "SELAMAT DATANG DI DTIC CONNECT • PANTAU STATUS PEKERJAAN SECARA REAL-TIME • KOLABORASI, KREATIVITAS, DAN KETEPATAN WAKTU •";
const RunningText = memo(function RunningText({ surface, text }: { surface: string; text: string }) {
  return (
    <footer className={cn("flex h-12 shrink-0 items-center overflow-hidden rounded-xl", surface)} aria-label="Running text">
      <div className={cn("display-ticker flex w-max items-center whitespace-nowrap text-sm font-bold tracking-[0.15em]", text)}>
        <span className="pr-12">{TICKER}</span>
        <span className="pr-12" aria-hidden="true">{TICKER}</span>
      </div>
    </footer>
  );
});

/* ---------- komponen tampilan ---------- */
type Toast = { key: number; item: DisplayItem };


function OrderCard({ item, t, highlight, showStatus }: { item: DisplayItem; t: Theme; highlight: boolean; showStatus: boolean }) {
  const p = PALETTE[t];
  const urgent = item.priorityTone === "danger";
  const high = item.priorityTone === "warning";
  return (
    <li
      className={cn(
        "rounded-xl p-3.5 ring-1 ring-inset transition-colors duration-500 motion-safe:animate-[fadein_0.6s_ease-out]",
        p.card,
        highlight && "ring-2 ring-[#facc15]",
      )}
      data-order={item.orderNumber}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={cn("font-mono text-3xl leading-none font-black tracking-tight tabular-nums", p.text)}>{item.orderNumber}</p>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {(urgent || high) && (
            <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide text-white", urgent ? "bg-[#b91c1c]" : "bg-[#b45309]")}>
              {item.priorityName?.toUpperCase()}
            </span>
          )}
          {item.overdue && <span className="rounded-md bg-[#dc2626] px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">TERLAMBAT</span>}
        </div>
      </div>
      <p className={cn("mt-1.5 truncate text-xl font-semibold", p.text)}>{item.title}</p>
      <p className={cn("truncate text-base", p.muted)}>{item.designType} · {item.brandName}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
        <dt className={p.muted}>Pemohon</dt>
        <dd className={cn("truncate font-medium", p.text)}>{item.requesterName}</dd>
        <dt className={p.muted}>PIC</dt>
        <dd className={cn("font-semibold leading-snug", p.text)}>{item.picNames.length ? item.picNames.join(", ") : "Belum ada PIC"}</dd>
        <dt className={p.muted}>Tenggat</dt>
        <dd className={p.muted}>{formatDeadline(item.deadlineAt)}</dd>
      </dl>
      {showStatus && (
        <span className={cn("mt-2 inline-block rounded-md px-2.5 py-0.5 text-xs font-bold tracking-wide", STATUS_PILL[item.status][t])}>
          {STATUS_META[item.status].label.toUpperCase()}
        </span>
      )}
    </li>
  );
}

function Column({
  kind,
  total,
  items,
  page,
  t,
  highlight,
  showStatus,
}: {
  kind: keyof typeof COLUMN;
  total: number;
  items: DisplayItem[];
  page: number;
  t: Theme;
  highlight: Set<string>;
  showStatus: boolean;
}) {
  const p = PALETTE[t];
  const c = COLUMN[kind];
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = page % pages;
  const visible = items.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col rounded-2xl ring-1 ring-inset", p.panel)} aria-label={c.label} data-column={kind}>
      <header className={cn("flex items-center justify-between gap-3 border-b px-5 py-3.5", t === "dark" ? "border-[#1f2937]" : "border-[#e5e7eb]")}>
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("h-7 w-1.5 shrink-0 rounded-full", c.bar)} aria-hidden="true" />
          <h2 className={cn("truncate text-xl font-black tracking-wide", t === "dark" ? c.dark : c.accent)}>{c.label}</h2>
        </div>
        <span className={cn("shrink-0 rounded-full px-3.5 py-0.5 text-lg font-bold tabular-nums", p.card)} data-count={total}>{total}</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3.5">
        {items.length === 0 ? (
          <p className={cn("flex flex-1 items-center justify-center text-lg", p.muted)}>Tidak ada order</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {visible.map((it) => (
              <OrderCard key={it.id} item={it} t={t} highlight={highlight.has(it.id)} showStatus={showStatus} />
            ))}
          </ul>
        )}
        <div className="mt-auto flex items-center justify-between text-sm">
          <span className={p.muted}>{items.length > PAGE_SIZE ? `Halaman ${current + 1} dari ${pages}` : ""}</span>
          {total > items.length && <span className={p.muted}>+{total - items.length} order lainnya di sistem</span>}
        </div>
      </div>
    </section>
  );
}

export function LiveDisplay() {
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get, () => "dark") as Theme;
  const soundPref = useSyncExternalStore(soundStore.subscribe, soundStore.get, () => "off");
  const clock = useSyncExternalStore(clockSubscribe, clockSnapshot, clockServer);
  const fullscreen = useSyncExternalStore(fsSubscribe, fsSnapshot, fsServer);

  const [data, setData] = useState<DisplaySnapshot | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [audioRaw, setAudio] = useState<AudioState>("off");
  const volume = readVolume(useSyncExternalStore(volumeStore.subscribe, volumeStore.get, () => String(DEFAULT_VOLUME)));
  const [playing, setPlaying] = useState<SoundKind | null>(null);
  // Preferensi "on" yang tersimpan setelah reload belum bisa diputar: browser butuh klik pengguna lagi.
  const audio: AudioState = audioRaw === "off" && soundPref === "on" ? "blocked" : audioRaw;
  const router = useRouter();
  const [pageTick, setPageTick] = useState(0);

  const baseline = useRef<Map<string, string> | null>(null);
  const lastSeq = useRef(0);
  const seqCounter = useRef(0);
  const audioCtx = useRef<AudioContext | null>(null);
  const bus = useRef<GainNode | null>(null);
  const oscs = useRef<OscillatorNode[]>([]);
  const playTimer = useRef<number | undefined>(undefined);
  const volumeRef = useRef(volume);
  const soundOn = useRef(false);
  const chimes = useRef(0);
  const toastKey = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const handleEventsRef = useRef<(events: DisplayEvent<DisplayItem>[]) => void>(() => {});


  /** Mengambil AudioContext yang ada, atau membuat satu kali (hanya dipanggil dari klik pengguna). */
  function ensureAudio() {
    let ctx = audioCtx.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext();
      const out = ctx.createGain();
      out.gain.value = volumeRef.current / 100;
      out.connect(ctx.destination);
      audioCtx.current = ctx;
      bus.current = out;
    }
    return ctx;
  }

  function startPattern(kind: SoundKind) {
    const ctx = audioCtx.current;
    const out = bus.current;
    if (!ctx || !out) return;
    stopOscillators(oscs.current); // cegah bunyi bertumpuk
    window.clearTimeout(playTimer.current);
    scheduleSound(ctx, out, kind, oscs.current);
    setPlaying(kind);
    playTimer.current = window.setTimeout(() => setPlaying(null), soundLengthMs(kind) + 20);
  }

  function playEvent(kind: SoundKind) {
    if (!soundOn.current) return;
    const ctx = audioCtx.current;
    if (!ctx || ctx.state !== "running") {
      setAudio("blocked");
      return;
    }
    startPattern(kind);
    chimes.current += 1;
    rootRef.current?.setAttribute("data-chimes", String(chimes.current));
    rootRef.current?.setAttribute("data-last-event", kind);
  }

  function handleEvents(events: DisplayEvent<DisplayItem>[]) {
    if (events.length === 0) return;
    const ids = events.map((e) => e.item.id);
    setHighlight((prev) => new Set([...prev, ...ids]));
    window.setTimeout(() => setHighlight((prev) => new Set([...prev].filter((id) => !ids.includes(id)))), 5000);
    const news = events.filter((e): e is Extract<DisplayEvent<DisplayItem>, { kind: "new" }> => e.kind === "new");
    if (news.length) {
      const fresh = news.slice(0, MAX_TOASTS).map((e) => ({ key: ++toastKey.current, item: e.item }));
      setToasts((prev) => [...fresh, ...prev].slice(0, MAX_TOASTS));
      fresh.forEach((t) => window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.key !== t.key)), TOAST_MS));
      playEvent("new"); // satu bunyi per pengajuan, walau beberapa order masuk dalam satu snapshot
    } else {
      playEvent("status");
    }
  }

  // Sinkronkan ref setelah render (dipakai polling tanpa stale closure).
  useEffect(() => {
    soundOn.current = audio === "on";
    volumeRef.current = volume;
    handleEventsRef.current = handleEvents;
  });

  // Polling: satu loop per mount; cleanup membatalkan timer & request (aman untuk Strict Mode).
  useEffect(() => {
    let stopped = false;
    let failures = 0;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    async function tick() {
      if (stopped) return;
      const seq = ++seqCounter.current;
      controller = new AbortController();
      setFetching(true);
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store", signal: controller.signal });
        if (res.status === 401 || res.status === 403) {
          router.replace("/dtic/login");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const snap = (await res.json()) as DisplaySnapshot;
        if (stopped) return;
        if (!isNewerResponse(lastSeq.current, seq)) return; // respons usang
        lastSeq.current = seq;
        failures = 0;
        setLoadError(false);
        setLastOk(new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour12: false }));
        const all = [...snap.queue.items, ...snap.inProgress.items, ...snap.done.items];
        const { next, events } = diffDisplay(baseline.current, all);
        baseline.current = next;
        setData(snap);
        handleEventsRef.current(events);
        timer = window.setTimeout(tick, POLL_MS);
      } catch (err) {
        if (stopped || (err instanceof DOMException && err.name === "AbortError")) return;
        failures += 1;
        setLoadError(true);
        timer = window.setTimeout(tick, Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** failures));
      } finally {
        if (!stopped) setFetching(false);
      }
    }

    timer = window.setTimeout(tick, 0);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [router]);

  // Volume berubah: ubah gain master dengan transisi halus (tanpa membuat AudioContext).
  useEffect(() => {
    const ctx = audioCtx.current;
    if (ctx && bus.current) bus.current.gain.setTargetAtTime(volume / 100, ctx.currentTime, 0.02);
  }, [volume]);

  // Bersihkan AudioContext saat komponen dilepas (juga berlaku untuk Strict Mode di dev).
  useEffect(() => {
    const list = oscs.current; // array ini dikosongkan di tempat, jadi referensinya tetap sama
    return () => {
      stopOscillators(list);
      window.clearTimeout(playTimer.current);
      void audioCtx.current?.close().catch(() => {});
      audioCtx.current = null;
      bus.current = null;
    };
  }, []);

  // Rotasi halaman tiap kolom.
  useEffect(() => {
    const id = window.setInterval(() => setPageTick((n) => n + 1), PAGE_MS);
    return () => window.clearInterval(id);
  }, []);

  /** Dipanggil dari klik pengguna: membuka AudioContext (syarat autoplay browser), lalu memutar `kind`. */
  function unlockSound(kind: SoundKind) {
    const ctx = ensureAudio();
    void ctx.resume().then(
      () => {
        if (ctx.state !== "running") {
          setAudio("blocked");
          return;
        }
        soundStore.set("on");
        setAudio("on");
        startPattern(kind);
      },
      () => setAudio("blocked"),
    );
  }
  function enableSound() {
    unlockSound("status");
  }
  /** Tes suara: memutar nada order baru tanpa membuat order atau menambah hitungan bunyi. */
  function testSound() {
    const ctx = audioCtx.current;
    if (audio === "on" && ctx?.state === "running") startPattern("new");
    else unlockSound("new");
  }
  function disableSound() {
    soundStore.set("off");
    setAudio("off");
    stopOscillators(oscs.current);
    window.clearTimeout(playTimer.current);
    setPlaying(null);
    void audioCtx.current?.suspend().catch(() => {});
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }

  const p = PALETTE[theme];
  const connection = loadError ? "KONEKSI TERPUTUS" : fetching && data ? "MEMPERBARUI" : "LIVE";
  const connectionClass = loadError ? "bg-[#7f1d1d] text-[#fecaca]" : fetching && data ? "bg-[#1e3a8a] text-[#bfdbfe]" : "bg-[#064e3b] text-[#a7f3d0]";
  const page = pageTick;

  return (
    <div ref={rootRef} data-theme={theme} data-sound={audio} data-chimes={0} data-last-event="" className={cn("flex h-dvh w-full flex-col gap-3 overflow-hidden p-4", p.root)}>
      <header className={cn("flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3", p.header, "ring-1 ring-inset", p.ring)}>
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-[#0f766e] text-base font-black text-white" aria-hidden="true">DT</span>
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-[#0f766e] dark:text-[#5eead4]">DTIC CONNECT</p>
            <h1 className="text-2xl font-black tracking-tight">LIVE ORDER DISPLAY</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={cn("rounded-lg px-3 py-1.5 text-sm font-black tracking-wide", connectionClass)} role="status" aria-live="polite">{connection}</span>
          <span className={cn("rounded-lg px-3 py-1.5 font-mono text-xl font-bold tabular-nums", p.card)} aria-label="Jam dan tanggal WIB">
            {clock ? clock.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour12: false }) : "--:--:--"}
            <span className={cn("ml-2 text-sm", p.muted)}>{clock ? dateLong(clock.toISOString()) : ""} WIB</span>
          </span>
          {data && lastOk && <span className={cn("text-xs", p.muted)}>Diperbarui {lastOk}</span>}
          <div className={cn("flex items-center gap-2 rounded-lg px-3 py-1.5", p.card)}>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={volume}
              onChange={(e) => volumeStore.set(e.target.value)}
              aria-label="Volume notifikasi suara"
              aria-valuetext={`${volume} persen`}
              className="w-24 accent-[#0f766e]"
            />
            <output className="w-10 text-right font-mono text-sm font-bold tabular-nums" aria-live="off">{volume}%</output>
          </div>
          <button type="button" onClick={testSound} className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold", p.card)}>
            <Play className="size-4" aria-hidden="true" />
            Tes Suara
          </button>
          <button
            type="button"
            onClick={audio === "on" ? disableSound : enableSound}
            aria-pressed={audio === "on"}
            className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold", audio === "on" ? "bg-[#064e3b] text-[#a7f3d0]" : audio === "blocked" ? "bg-[#78350f] text-[#fde68a]" : p.card)}
          >
            {audio === "on" ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
            {audio === "on" ? "Nonaktifkan Suara" : audio === "blocked" ? "Aktifkan Suara Lagi" : "Aktifkan Suara"}
          </button>
          {playing && (
            <span role="status" data-playing={playing} className={cn("rounded-lg px-3 py-1.5 text-sm font-bold", p.muted)}>
              ♪ Memutar {playing === "new" ? "notifikasi order baru" : "notifikasi status"}…
            </span>
          )}
          <button type="button" onClick={() => themeStore.set(theme === "dark" ? "light" : "dark")} className={cn("rounded-lg p-2.5", p.card)} aria-label={theme === "dark" ? "Gunakan tema terang" : "Gunakan tema gelap"} title={theme === "dark" ? "Tema terang" : "Tema gelap"}>
            {theme === "dark" ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
          </button>
          <button type="button" onClick={toggleFullscreen} className={cn("rounded-lg p-2.5", p.card)} aria-label={fullscreen ? "Keluar layar penuh" : "Layar penuh"} title={fullscreen ? "Keluar layar penuh" : "Layar penuh"}>
            {fullscreen ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}
          </button>
        </div>
      </header>
      {audio === "blocked" && (
        <p role="alert" className="rounded-lg bg-[#78350f] px-4 py-2 text-sm font-semibold text-[#fde68a]">
          Suara belum dapat diputar. Tekan &quot;Aktifkan Suara Lagi&quot; agar browser mengizinkan notifikasi suara.
        </p>
      )}

      {!data ? (
        <div className={cn("flex flex-1 items-center justify-center text-xl", p.muted)} aria-live="polite">
          {loadError ? "Tidak dapat memuat data. Mencoba lagi…" : "Memuat order…"}
        </div>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
          <Column kind="queue" total={data.queue.total} items={data.queue.items} page={page} t={theme} highlight={highlight} showStatus={false} />
          <Column kind="progress" total={data.inProgress.total} items={data.inProgress.items} page={page} t={theme} highlight={highlight} showStatus={false} />
          <Column kind="done" total={data.done.total} items={data.done.items} page={page} t={theme} highlight={highlight} showStatus />
        </main>
      )}

      {/* Popup pengajuan baru: tidak menutupi layar, hilang sendiri. */}
      <div className="pointer-events-none fixed top-24 right-4 z-50 flex w-[22rem] flex-col gap-3" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.key} className="pointer-events-auto rounded-xl border-l-4 border-[#3b82f6] bg-[#0b1220] p-4 text-white shadow-2xl motion-safe:animate-[fadein_0.4s_ease-out]" role="status">
            <p className="text-xs font-black tracking-[0.2em] text-[#60a5fa]">PENGAJUAN BARU</p>
            <p className="mt-1 font-mono text-xl font-bold">{t.item.orderNumber}</p>
            <p className="truncate text-base font-semibold">{t.item.title}</p>
            <p className="truncate text-sm text-[#cbd5e1]">Pemohon: {t.item.requesterName}</p>
            <p className="truncate text-sm text-[#cbd5e1]">Brand: {t.item.brandName}</p>
          </div>
        ))}
      </div>

      <RunningText surface={p.card} text={p.text} />
    </div>
  );
}
