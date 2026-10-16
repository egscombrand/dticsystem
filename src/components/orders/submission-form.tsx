"use client";

import { ArrowLeft, ArrowRight, Briefcase, CalendarClock, Camera, Check, CheckCircle2, ClipboardCheck, Copy, ExternalLink, FileText, KeyRound, Link2, Monitor, Palette, Paperclip, Send, Upload, UserRound, Users, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/button";
import { SubmitConfirmDialog } from "@/components/orders/submit-confirm-dialog";
import { RichTextEditor, type RichTextChange } from "@/components/rich-text/rich-text-editor";
import { Field, Input, Select } from "@/components/ui/form";
import { UPLOAD_LIMITS } from "@/lib/config/app";
import { DESIGN_SIZE_PRESETS } from "@/lib/config/order-options";
import { formatDate, formatDateTime, formatLongDate, toDateKey } from "@/lib/dates";
import { ACCEPT_ATTRIBUTE, ALLOWED_EXTENSIONS_LABEL, checkFileBasics, formatFileSize } from "@/lib/files";
import { toFieldErrors, type FieldErrors } from "@/lib/validation/common";
import { orderSubmissionSchema } from "@/lib/validation/order";
import type { OrderTypeOption, PriorityOption, TeamOption } from "@/lib/types";

type Brand = { id: string; name: string };
export type SubmissionOptions = {
  brands: Brand[];
  orderTypes: Pick<OrderTypeOption, "id" | "name" | "requiresDetail" | "teamId">[];
  priorities: Pick<PriorityOption, "code" | "name">[];
  defaultPriority: string;
  /** Tim penanggung jawab per kategori, dengan anggota aktif. Seluruh anggota tim menjadi PIC (ditentukan server). */
  teams: TeamOption[];
};
/** Status notifikasi Telegram, terpisah dari status penyimpanan pengajuan. */
type NotificationState = "sent" | "pending" | "failed" | "no_destination";

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; progress: number }
  | { kind: "error"; message: string; title?: string }
  /** Koneksi putus setelah pengiriman: pengajuan mungkin sudah tersimpan. Harus diperiksa sebelum kirim ulang. */
  | { kind: "unknown" }
  | {
      kind: "success";
      orderNumber: string;
      createdAt: string;
      deadlineAt: string;
      brandName: string;
      designType: string;
      attachmentCount: number;
      notification?: NotificationState;
    };

/** Ringkasan untuk langkah tinjau (dibaca dari isian saat masuk langkah terakhir). */
type ReviewSummary = {
  title: string;
  teamName: string;
  teamSlug: string;
  typeName: string;
  brandName: string;
  requesterName: string;
  pics: { id: string; name: string }[];
  priorityName: string;
  /** Tanggal deadline (format Indonesia) dan jam WIB; tanpa jam = 23.59 WIB (akhir hari). */
  deadlineDate: string;
  deadlineTime: string;
  endOfDay: boolean;
  sizeLabel: string;
  driveUrl: string;
  briefText: string;
  files: { name: string; size: number }[];
};

const AVATAR_TONES = ["bg-brand-violet", "bg-brand-blue", "bg-brand-emerald", "bg-accent", "bg-[#f59e0b]"];
/** Warna avatar konsisten per nama (bukan acak per render). */
function avatarTone(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

const REVIEW_TONE = {
  teal: "bg-accent-soft text-accent",
  blue: "bg-brand-sky text-brand-blue",
  violet: "bg-brand-violet-soft text-brand-violet",
  emerald: "bg-brand-mint text-brand-emerald",
} as const;

/** Kartu kelompok informasi pada langkah Tinjau (masuk bertahap, hover halus). */
function ReviewCard({ index, icon: Icon, title, tone, children }: { index: number; icon: typeof FileText; title: string; tone: keyof typeof REVIEW_TONE; children: React.ReactNode }) {
  return (
    <section
      className="form-rise min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      style={{ animationDelay: `${index * 45}ms` }}
      aria-label={title}
    >
      <h3 className="mb-3 flex items-center gap-2.5 text-sm font-semibold text-ink">
        <span className={cn("flex size-8 items-center justify-center rounded-lg", REVIEW_TONE[tone])}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function ReviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs font-medium text-ink-3">{label}</dt>
      <dd className="text-sm font-medium break-words text-ink">{value || "—"}</dd>
    </div>
  );
}

/** Field form client. Timestamp, nomor order & status Close diatur sistem/tim DTIC. */
const TEXT_FIELDS = [
  "requesterName",
  "requesterWhatsapp",
  "title",
  "brandId",
  "department",
  "teamId",
  "designTypeId",
  "designTypeOther",
  "sizePreset",
  "customWidth",
  "customHeight",
  "driveUrl",
  "deadline",
  "deadlineTime",
  "priority",
] as const;

const BRIEF_PLACEHOLDER = "Jelaskan kebutuhan, tujuan, detail pekerjaan, dan hasil yang diharapkan.";

const BRIEF_HINTS = ["Tujuan pekerjaan", "Isi / teks yang harus tampil", "Tahun", "Informasi wajib (logo, kontak, alamat)", "Konsep, warna, atau gaya", "Referensi & detail lain"];

/** Konfirmasi setelah penyimpanan benar-benar berhasil (dipanggil hanya dari respons 201/200 server). */
export function SubmissionReceipt({
  receipt,
  onReset,
}: {
  receipt: { orderNumber: string; createdAt: string; deadlineAt: string; brandName: string; designType: string; attachmentCount: number; notification?: NotificationState };
  onReset: () => void;
}) {
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const trackHref = `/riwayat?order=${encodeURIComponent(receipt.orderNumber)}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(receipt.orderNumber);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied("idle"), 2200);
  }
  const rows: [string, string][] = [
    ["Tanggal pengajuan", formatDateTime(receipt.createdAt)],
    ["Brand pemohon", receipt.brandName || "—"],
    ["Jenis request", receipt.designType || "—"],
    ["Deadline", formatLongDate(receipt.deadlineAt)],
  ];
  return (
    <div className="form-rise rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-10" role="status" aria-live="polite">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ecfdf5,#d1fae5)] ring-1 ring-brand-emerald/30">
        <CheckCircle2 className="check-pop size-7 text-brand-emerald" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-center text-xl font-semibold text-navy">Request berhasil diajukan</h2>
      <p className="mt-1 text-center text-sm text-ink-3">Request Anda sudah tersimpan dan masuk antrean peninjauan tim DTIC.</p>

      <div className="mx-auto mt-6 max-w-md rounded-xl border border-teal/25 bg-teal/5 p-4 text-center">
        <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">Nomor order</p>
        <p className="mt-1 font-mono text-2xl font-semibold tracking-tight text-navy">{receipt.orderNumber}</p>
        <button
          type="button"
          onClick={copy}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-teal/30 bg-surface px-3 py-1.5 text-[13px] font-medium text-teal hover:bg-teal/10"
        >
          <Copy className="size-3.5" aria-hidden="true" />
          {copied === "ok" ? "Tersalin" : copied === "fail" ? "Gagal menyalin" : "Salin Nomor Order"}
        </button>
      </div>

      <dl className="mx-auto mt-6 grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{k}</dt>
            <dd className="text-right font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      {receipt.notification && (
        <p className="mx-auto mt-4 max-w-md text-center text-[13px] text-ink-2" role="status" data-testid="notification-note">
          {receipt.notification === "sent" && "Pengajuan tersimpan dan notifikasi sudah terkirim ke tim DTIC."}
          {receipt.notification === "pending" && "Pengajuan tersimpan. Notifikasi sedang diproses ulang otomatis oleh sistem."}
          {(receipt.notification === "failed" || receipt.notification === "no_destination") && "Pengajuan tersimpan. Notifikasi Telegram belum terkirim; tim DTIC tetap dapat menemukan pengajuan ini dengan nomor di atas."}
        </p>
      )}

      <div className="mx-auto mt-6 flex max-w-md gap-3 rounded-lg bg-subtle px-4 py-3 text-[13px] text-ink-2">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden="true" />
        <p>
          Simpan nomor order <span className="font-mono font-medium">{receipt.orderNumber}</span> untuk memantau progres request Anda
          melalui menu Riwayat Request. Tidak perlu kode tambahan.
        </p>
      </div>

      <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row sm:justify-center">
        <Link href={trackHref} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-teal px-4 text-sm font-medium text-white hover:bg-teal/90">
          Lihat Status Request <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        <Button variant="secondary" onClick={onReset}>Ajukan request lain</Button>
      </div>
    </div>
  );
}

function send(form: FormData, onProgress: (p: number) => void): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/public/orders");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => resolve({ status: xhr.status, body: (xhr.response as Record<string, unknown>) ?? {} });
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    xhr.timeout = 120_000;
    xhr.send(form);
  });
}

/** Warna per kategori (aksen harmonis). Kelas ditulis lengkap agar terdeteksi Tailwind. */
const TEAM_TONE: Record<string, { card: string; hover: string; iconOn: string; iconOff: string; text: string }> = {
  "graphic-design": {
    card: "border-brand-violet bg-brand-violet-soft shadow-card ring-1 ring-brand-violet/30",
    hover: "hover:border-brand-violet/60",
    iconOn: "bg-brand-violet text-white",
    iconOff: "bg-brand-violet-soft text-brand-violet",
    text: "text-brand-violet",
  },
  "it-system-management": {
    card: "border-brand-blue bg-brand-sky shadow-card ring-1 ring-brand-blue/30",
    hover: "hover:border-brand-blue/60",
    iconOn: "bg-brand-blue text-white",
    iconOff: "bg-brand-sky text-brand-blue",
    text: "text-brand-blue",
  },
  "dokumentasi-event": {
    card: "border-brand-emerald bg-brand-mint shadow-card ring-1 ring-brand-emerald/30",
    hover: "hover:border-brand-emerald/60",
    iconOn: "bg-brand-emerald text-white",
    iconOff: "bg-brand-mint text-brand-emerald",
    text: "text-brand-emerald",
  },
};

export function SubmissionForm({ brands, orderTypes, priorities, defaultPriority, teams }: SubmissionOptions) {
  const formRef = useRef<HTMLFormElement>(null);
  const submissionKey = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [files, setFiles] = useState<File[]>([]);
  const [sizePreset, setSizePreset] = useState("");
  const [designTypeId, setDesignTypeId] = useState("");
  const [brief, setBrief] = useState<RichTextChange | null>(null);
  const [formKey, setFormKey] = useState(0); // remount editor saat form di-reset
  const [teamId, setTeamId] = useState("");
  const [picIds, setPicIds] = useState<string[]>([]); // anggota tim yang dipilih pemohon (awal: tidak ada)
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [step, setStep] = useState(0); // langkah aktif (0–3): mengatur tampilan dan validasi per langkah
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [dragging, setDragging] = useState(false); // dropzone: file sedang diseret ke area unggah
  const inFlight = useRef(false); // guard sinkron: klik berulang tidak memulai pengiriman kedua
  // Kategori = tim. Jenis pekerjaan & tim penanggung jawab mengikuti kategori; server menetapkan seluruh anggota tim.
  const team = teams.find((t) => t.id === teamId) ?? null;
  const typesForTeam = orderTypes.filter((t) => t.teamId === teamId);
  const isDesign = team?.slug === "graphic-design";
  const requiresDetail = orderTypes.find((t) => t.id === designTypeId)?.requiresDetail ?? false;
  const [minDeadline, setMinDeadline] = useState<string | undefined>(undefined);

  const sending = phase.kind === "sending";

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const next = [...files];
    let err: string | null = null;
    for (const f of incoming) {
      const problem = checkFileBasics(f);
      if (problem) {
        err = problem;
        continue;
      }
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
      next.push(f);
    }
    if (next.length > UPLOAD_LIMITS.maxFiles) {
      err = `Maksimal ${UPLOAD_LIMITS.maxFiles} dokumen.`;
      next.length = UPLOAD_LIMITS.maxFiles;
    }
    if (next.reduce((s, f) => s + f.size, 0) > UPLOAD_LIMITS.maxTotalBytes) {
      err = `Total ukuran dokumen maksimal ${formatFileSize(UPLOAD_LIMITS.maxTotalBytes)}.`;
      return setErrors((e) => ({ ...e, attachments: err! }));
    }
    setFiles(next);
    setErrors((e) => {
      const rest = { ...e };
      delete rest.attachments;
      return err ? { ...rest, attachments: err } : rest;
    });
  }

  /**
   * Validasi & susun data pengiriman. Mengembalikan null bila ada isian belum valid (pesan & fokus diatur di sini).
   * Dipanggil saat tombol ditekan DAN saat konfirmasi, sehingga validasi tidak pernah dilewati.
   */
  function collect(form: HTMLFormElement): { raw: Record<string, string>; body: FormData } | null {
    const fd = new FormData(form);
    submissionKey.current ??= crypto.randomUUID();

    const raw: Record<string, string> = { submissionKey: submissionKey.current };
    for (const k of TEXT_FIELDS) {
      const v = fd.get(k);
      if (typeof v === "string" && v !== "") raw[k] = v;
    }
    if (brief && brief.text.trim()) raw.briefDoc = JSON.stringify(brief.json);
    const parsed = orderSubmissionSchema.safeParse({ ...raw, picIds });
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error);
      setErrors((prev) => (prev.attachments ? { ...fe, attachments: prev.attachments } : fe));
      setPhase({ kind: "error", message: "Ada isian yang perlu diperbaiki. Periksa field bertanda merah." });
      const firstKey = Object.keys(fe)[0];
      const target = firstKey === "briefDoc" ? "#brief" : `[name="${firstKey}"]`;
      form.querySelector<HTMLElement>(target)?.focus();
      return null;
    }

    const body = new FormData();
    for (const [k, v] of Object.entries(raw)) body.set(k, v);
    for (const id of picIds) body.append("picIds", id);
    for (const f of files) body.append("attachments", f, f.name);
    return { raw, body };
  }

  /** Tekan "Kirim pengajuan": hanya validasi lalu buka konfirmasi. Belum ada data yang dikirim. */
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending || inFlight.current || confirmOpen) return;
    if (!collect(e.currentTarget)) return;
    setConfirmOpen(true);
  }

  /** "Ya, Kirim Pengajuan": satu-satunya jalur kirim. Memakai endpoint & idempotency key yang sama dengan sebelumnya. */
  async function confirmSubmit() {
    if (inFlight.current) return;
    const form = formRef.current;
    if (!form) return;
    inFlight.current = true;
    try {
      const data = collect(form); // validasi ulang saat kirim
      if (!data) {
        setConfirmOpen(false);
        form.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      setErrors({});
      setPhase({ kind: "sending", progress: 0 });
      const res = await send(data.body, (p) => setPhase({ kind: "sending", progress: p }));
      setConfirmOpen(false);
      // 201 (baru) atau 200 (pengiriman ulang yang sama): pengajuan TERSIMPAN. Status Telegram dibaca terpisah.
      if ((res.status === 200 || res.status === 201) && typeof res.body.orderNumber === "string") {
        const note = res.body.notification as { state?: NotificationState } | undefined;
        setPhase({
          kind: "success",
          orderNumber: String(res.body.orderNumber),
          createdAt: String(res.body.createdAt),
          deadlineAt: String(res.body.deadlineAt),
          brandName: String(res.body.brandName ?? ""),
          designType: String(res.body.designType ?? ""),
          attachmentCount: Number(res.body.attachmentCount ?? 0),
          notification: note?.state,
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (res.body.fieldErrors && typeof res.body.fieldErrors === "object") setErrors(res.body.fieldErrors as FieldErrors);
      // Pengajuan belum tersimpan (validasi, batas, atau kegagalan database): tidak ada nomor pengajuan.
      setPhase({
        kind: "error",
        message: typeof res.body.error === "string" ? res.body.error : `Pengajuan gagal (HTTP ${res.status}).`,
      });
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      // Koneksi terputus atau waktu habis: commit mungkin sudah terjadi. Jangan klaim "belum tersimpan".
      setConfirmOpen(false);
      setPhase({ kind: "unknown" });
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } finally {
      inFlight.current = false;
    }
  }

  /** Rekonsiliasi: cari pengajuan dengan kunci yang sama. Ditemukan → tampilkan tanda terima; tidak → boleh kirim ulang. */
  async function checkSubmissionStatus() {
    const key = submissionKey.current;
    if (!key) return setPhase({ kind: "error", message: "Isian belum pernah dikirim. Silakan kirim pengajuan." });
    try {
      const res = await fetch(`/api/public/orders/status?key=${encodeURIComponent(key)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && body.found === true) {
        setPhase({
          kind: "success",
          orderNumber: String(body.orderNumber),
          createdAt: String(body.createdAt),
          deadlineAt: String(body.deadlineAt),
          brandName: String(body.brandName ?? ""),
          designType: String(body.designType ?? ""),
          attachmentCount: Number(body.attachmentCount ?? 0),
        });
        return;
      }
      // 404 berarti "tidak ditemukan" (bukan kegagalan pemeriksaan).
      if (body.found === false) {
        setPhase({ kind: "error", title: "Pengajuan belum ditemukan", message: "Pengajuan belum tersimpan. Anda dapat mengirim ulang; isian form dipertahankan." });
        return;
      }
      setPhase({ kind: "error", title: "Status belum dapat diperiksa", message: "Pemeriksaan status gagal sementara. Coba lagi beberapa saat, atau hubungi tim DTIC." });
    } catch {
      setPhase({ kind: "error", title: "Status belum dapat diperiksa", message: "Koneksi bermasalah. Coba periksa status lagi setelah jaringan stabil." });
    }
  }

  function reset() {
    formRef.current?.reset();
    submissionKey.current = null;
    setFiles([]);
    setErrors({});
    setSizePreset("");
    setDesignTypeId("");
    setBrief(null);
    setTeamId("");
    setPicIds([]);
    setFormKey((k) => k + 1);
    setPhase({ kind: "idle" });
    window.scrollTo({ top: 0 });
  }

  if (phase.kind === "success") {
    return <SubmissionReceipt receipt={phase} onReset={reset} />;
  }


  const e = errors;
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const STEP_LABELS = ["Kategori", "Detail pekerjaan", "Tim & deadline", "Tinjau"];
  const STEP_FIELDS: string[][] = [
    ["teamId", "designTypeId"],
    ["requesterName", "requesterWhatsapp", "brandId", "department", "title", "sizePreset", "customWidth", "customHeight", "designTypeOther", "briefDoc", "driveUrl", "attachments"],
    ["picIds", "deadline", "deadlineTime", "priority"],
  ];
  const TEAM_ICON: Record<string, typeof Palette> = { "graphic-design": Palette, "it-system-management": Monitor, "dokumentasi-event": Camera };
  const stepLast = step >= STEP_LABELS.length - 1;

  /** Isi mentah form (sama dengan collect) untuk validasi per langkah. Tidak mengubah state. */
  function readRaw(form: HTMLFormElement): Record<string, string> {
    const fd = new FormData(form);
    submissionKey.current ??= crypto.randomUUID();
    const raw: Record<string, string> = { submissionKey: submissionKey.current };
    for (const k of TEXT_FIELDS) {
      const v = fd.get(k);
      if (typeof v === "string" && v !== "") raw[k] = v;
    }
    if (brief && brief.text.trim()) raw.briefDoc = JSON.stringify(brief.json);
    return raw;
  }

  /** Galat untuk field pada langkah tertentu saja (memakai skema server yang sama). */
  function stepErrors(i: number): FieldErrors {
    const form = formRef.current;
    if (!form) return {};
    const parsed = orderSubmissionSchema.safeParse({ ...readRaw(form), picIds });
    if (parsed.success) return {};
    const all = toFieldErrors(parsed.error) as FieldErrors;
    return Object.fromEntries(Object.entries(all).filter(([k]) => STEP_FIELDS[i].includes(k))) as FieldErrors;
  }

  function buildSummary(): ReviewSummary {
    const form = formRef.current;
    const fd = form ? new FormData(form) : new FormData();
    const text = (k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");
    const dateKey = text("deadline");
    const timeKey = text("deadlineTime");
    const typeName = typesForTeam.find((t) => t.id === designTypeId)?.name ?? "";
    return {
      title: text("title"),
      teamName: team?.name ?? "",
      teamSlug: team?.slug ?? "",
      typeName: text("designTypeOther") || typeName,
      brandName: brands.find((b) => b.id === text("brandId"))?.name ?? "",
      requesterName: text("requesterName"),
      pics: team ? team.members.filter((m) => picIds.includes(m.id)).map((m) => ({ id: m.id, name: m.name })) : [],
      priorityName: priorities.find((p) => p.code === text("priority"))?.name ?? "",
      deadlineDate: dateKey ? formatDate(`${dateKey}T12:00:00+07:00`) : "",
      deadlineTime: timeKey ? `${timeKey.replace(":", ".")} WIB` : "23.59 WIB",
      endOfDay: !timeKey,
      sizeLabel: isDesign ? (DESIGN_SIZE_PRESETS.find((sp) => sp.value === sizePreset)?.label ?? "") : "",
      driveUrl: text("driveUrl"),
      briefText: brief?.text.trim() ?? "",
      files: files.map((file) => ({ name: file.name, size: file.size })),
    };
  }

  function goTo(i: number) {
    setPhase((p) => (p.kind === "error" ? { kind: "idle" } : p));
    setStep(i);
    if (i === STEP_LABELS.length - 1) setSummary(buildSummary());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function next() {
    const errs = stepErrors(step);
    setErrors((prev) => {
      const rest = Object.fromEntries(Object.entries(prev).filter(([k]) => !STEP_FIELDS[step].includes(k)));
      return { ...rest, ...errs };
    });
    if (Object.keys(errs).length > 0) {
      setPhase({ kind: "error", message: "Ada isian yang perlu diperbaiki. Periksa field bertanda merah." });
      const firstKey = Object.keys(errs)[0];
      const target = firstKey === "briefDoc" ? "#brief" : `[name="${firstKey}"]`;
      formRef.current?.querySelector<HTMLElement>(target)?.focus();
      return;
    }
    goTo(step + 1);
  }

  const reviewTone = {
    badge:
      summary?.teamSlug === "it-system-management" ? "bg-brand-sky text-[#1d4ed8] ring-brand-blue/30"
      : summary?.teamSlug === "dokumentasi-event" ? "bg-brand-mint text-brand-deep ring-brand-emerald/30"
      : "bg-brand-violet-soft text-[#6d28d9] ring-brand-violet/30",
  };
  /** Kelompok wajib yang TERISI (bukan klaim valid; validasi tetap di server). */
  const requiredGroups = summary
    ? [
        ["Pemohon", Boolean(summary.requesterName && summary.brandName)],
        ["Detail pekerjaan", Boolean(summary.teamName && summary.typeName && summary.title)],
        ["PIC", summary.pics.length > 0],
        ["Deadline", Boolean(summary.deadlineDate)],
        ["Deskripsi", Boolean(summary.briefText)],
      ] as [string, boolean][]
    : [];

  const navBtn = "min-w-36";
  const primaryBtn = "bg-[linear-gradient(135deg,#0f766e,#10b981)] shadow-card hover:brightness-110 active:scale-[0.98] transition-transform duration-150 motion-reduce:transition-none";

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
      <input type="hidden" name="teamId" value={teamId} />
      <div className="flex min-w-0 flex-col gap-6">
        {phase.kind === "error" && <Alert kind="error" title={phase.title ?? "Pengajuan belum tersimpan"}>{phase.message}</Alert>}
        {phase.kind === "unknown" && (
          <Alert kind="info" title="Status pengajuan belum dapat dipastikan">
            <p>Koneksi terputus saat pengajuan dikirim, sehingga pengajuan mungkin sudah tersimpan. Periksa statusnya sebelum mengirim ulang agar tidak tercatat dua kali. Isian form tetap dipertahankan.</p>
            <div className="mt-3">
              <Button size="sm" variant="secondary" onClick={checkSubmissionStatus}>Periksa status pengajuan</Button>
            </div>
          </Alert>
        )}
        {(brands.length === 0 || orderTypes.length === 0) && <Alert kind="error" title="Data form belum lengkap">Pengajuan belum dapat dilakukan. Hubungi tim DTIC.</Alert>}

        {/* Stepper: status langkah berasal dari state `step`, bukan dekorasi. */}
        <nav aria-label="Langkah pengajuan">
          <ol className="flex items-center gap-2 sm:gap-3">
            {STEP_LABELS.map((label, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <li key={label} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                  <button
                    type="button"
                    disabled={i > step || sending}
                    onClick={() => i < step && goTo(i)}
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "flex min-w-0 items-center gap-2 rounded-lg text-left disabled:cursor-default",
                      done && "text-ink hover:text-accent",
                      active && "text-accent",
                      !done && !active && "text-ink-3",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ring-1 ring-inset transition-colors",
                        done && "bg-accent text-white ring-accent",
                        active && "bg-accent-soft text-accent ring-accent/40",
                        !done && !active && "bg-subtle text-ink-3 ring-line",
                      )}
                    >
                      {done ? <Check className="size-4" aria-hidden="true" /> : i + 1}
                    </span>
                    <span className={cn("hidden truncate text-[13px] font-medium md:inline", active && "font-semibold")}>{label}</span>
                  </button>
                  {i < STEP_LABELS.length - 1 && <span className={cn("h-px flex-1", done ? "bg-accent" : "bg-line")} aria-hidden="true" />}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-[13px] font-medium text-ink md:hidden" aria-live="polite">
            Langkah {step + 1} dari {STEP_LABELS.length}: {STEP_LABELS[step]}
          </p>
        </nav>

        {/* Langkah 1 — Kategori dan jenis pekerjaan */}
        <section hidden={step !== 0} className={"step-panel flex flex-col gap-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-8" + (step !== 0 ? " hidden" : "")} aria-labelledby="step-0-title">
          <header>
            <h2 id="step-0-title" className="text-lg font-semibold tracking-tight text-ink">Pilih kategori pekerjaan</h2>
            <p className="mt-1 text-sm text-ink-3">Kategori menentukan tim yang menerima request ini.</p>
          </header>
          <fieldset disabled={sending} className="flex flex-col gap-6">
            <legend className="sr-only">Kategori pekerjaan</legend>
            <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Kategori pekerjaan">
              {teams.map((t) => {
                const selected = teamId === t.id;
                const Icon = TEAM_ICON[t.slug] ?? Palette;
                const tone = TEAM_TONE[t.slug] ?? TEAM_TONE["graphic-design"];
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setTeamId(t.id);
                      setPicIds([]);
                      setDesignTypeId("");
                      setSizePreset("");
                      setErrors((prev) => {
                        const rest = { ...prev };
                        delete rest.teamId;
                        return rest;
                      });
                    }}
                    className={cn(
                      "group flex flex-col gap-3 rounded-2xl border p-4 text-left transition-all duration-200 motion-reduce:transition-none",
                      "hover:-translate-y-0.5 hover:shadow-card focus-visible:ring-3 focus-visible:ring-accent/25 focus-visible:outline-none",
                      selected ? tone.card : `border-line bg-surface ${tone.hover}`,
                    )}
                  >
                    <span className={cn("flex size-10 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110", selected ? tone.iconOn : "bg-subtle text-ink-2")}>
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-[15px] font-semibold text-ink">{t.name}</span>
                      <span className="mt-1 block text-[13px] leading-relaxed text-ink-3">{t.description}</span>
                    </span>
                    {selected && <span className={cn("mt-auto inline-flex items-center gap-1.5 text-xs font-semibold", tone.text)}><Check className="check-pop size-3.5" aria-hidden="true" /> Dipilih</span>}
                  </button>
                );
              })}
            </div>
            {e.teamId && <p className="text-[12.5px] text-bad" role="alert">{e.teamId}</p>}
            <Field label="Jenis Pekerjaan" htmlFor="designTypeId" required error={e.designTypeId} hint={team ? "Daftar mengikuti kategori yang dipilih." : "Pilih kategori terlebih dahulu."}>
              <Select id="designTypeId" name="designTypeId" value={designTypeId} onChange={(ev) => setDesignTypeId(ev.target.value)} required invalid={!!e.designTypeId} disabled={!team} className="h-11">
                <option value="" disabled>{team ? "Pilih jenis pekerjaan" : "Pilih kategori dulu"}</option>
                {typesForTeam.map((t) => <option key={t.id} value={t.id}>{t.requiresDetail ? `${t.name} (tulis sendiri)` : t.name}</option>)}
              </Select>
            </Field>
          </fieldset>
        </section>

        {/* Langkah 2 — Detail pekerjaan dan data pemohon */}
        <section hidden={step !== 1} className={"step-panel flex flex-col gap-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-8" + (step !== 1 ? " hidden" : "")} aria-labelledby="step-1-title">
          <header>
            <h2 id="step-1-title" className="text-lg font-semibold tracking-tight text-ink">Detail pekerjaan</h2>
            <p className="mt-1 text-sm text-ink-3">Data pemohon, judul, dan brief. Judul dan deskripsi diisi terpisah.</p>
          </header>
          <fieldset disabled={sending} className="grid gap-5 sm:grid-cols-2">
            <legend className="sr-only">Data pemohon dan detail pekerjaan</legend>
            <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase sm:col-span-2">Data pemohon</p>
            <Field label="Nama" htmlFor="requesterName" required error={e.requesterName} hint="Nama lengkap pemohon">
              <Input id="requesterName" name="requesterName" autoComplete="name" maxLength={120} required invalid={!!e.requesterName} className="h-11" />
            </Field>
            <Field label="Departemen / Divisi" htmlFor="department" required error={e.department}>
              <Input id="department" name="department" maxLength={120} required placeholder="mis. Marketing" invalid={!!e.department} className="h-11" />
            </Field>
            <Field label="Brand Pemohon" htmlFor="brandId" required error={e.brandId} hint="Brand/perusahaan Anda yang mengajukan request ke DTIC">
              <Select id="brandId" name="brandId" defaultValue="" required invalid={!!e.brandId} className="h-11">
                <option value="" disabled>Pilih brand pemohon</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="Nomor WhatsApp Aktif" htmlFor="requesterWhatsapp" required error={e.requesterWhatsapp} hint="Untuk konfirmasi terkait pengajuan request.">
              <Input id="requesterWhatsapp" name="requesterWhatsapp" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} required placeholder="Contoh: 081234567890" invalid={!!e.requesterWhatsapp} className="h-11" />
            </Field>
            <p className="mt-2 text-xs font-semibold tracking-wide text-ink-3 uppercase sm:col-span-2">Pekerjaan</p>
            <Field label="Judul Pekerjaan" htmlFor="title" required error={e.title} hint="Judul singkat dan jelas, mis. Desain Poster Seminar Lingkungan 2026." className="sm:col-span-2">
              <Input id="title" name="title" maxLength={160} placeholder="Contoh: Desain Poster Seminar Lingkungan 2026" required invalid={!!e.title} className="h-11" />
            </Field>
            {isDesign ? (
              <Field label="Ukuran" htmlFor="sizePreset" required error={e.sizePreset}>
                <Select id="sizePreset" name="sizePreset" value={sizePreset} onChange={(ev) => setSizePreset(ev.target.value)} required invalid={!!e.sizePreset} className="h-11">
                  <option value="" disabled>Pilih ukuran</option>
                  {DESIGN_SIZE_PRESETS.filter((s) => s.value !== "na").map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              </Field>
            ) : (
              team && <input type="hidden" name="sizePreset" value="na" />
            )}
            {requiresDetail && (
              <Field label="Sebutkan jenis desain" htmlFor="designTypeOther" required error={e.designTypeOther}>
                <Input id="designTypeOther" name="designTypeOther" maxLength={60} placeholder="mis. Desain merchandise kaos" autoFocus invalid={!!e.designTypeOther} className="h-11" />
              </Field>
            )}
            {sizePreset === "custom" && (
              <div className="grid grid-cols-2 gap-4 sm:col-span-2">
                <Field label="Lebar (cm)" htmlFor="customWidth" required error={e.customWidth}>
                  <Input id="customWidth" name="customWidth" inputMode="decimal" placeholder="mis. 60" invalid={!!e.customWidth} className="h-11" />
                </Field>
                <Field label="Tinggi (cm)" htmlFor="customHeight" required error={e.customHeight}>
                  <Input id="customHeight" name="customHeight" inputMode="decimal" placeholder="mis. 160" invalid={!!e.customHeight} className="h-11" />
                </Field>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <label htmlFor="brief" className="text-[13px] font-medium text-ink" onClick={() => document.getElementById("brief")?.focus()}>
                Deskripsi Pekerjaan<span className="ml-0.5 text-bad" aria-hidden="true">*</span>
              </label>
              <div id="brief-hint" className="rounded-xl bg-subtle px-4 py-3 text-[12.5px] text-ink-3">
                Jelaskan kebutuhan, tujuan, detail, dan hasil yang diharapkan. Sebaiknya mencakup:
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {BRIEF_HINTS.map((h) => (
                    <li key={h} className="rounded-full bg-surface px-2.5 py-0.5 text-ink-2 ring-1 ring-line">{h}</li>
                  ))}
                </ul>
              </div>
              <RichTextEditor key={formKey} id="brief" placeholder={BRIEF_PLACEHOLDER} disabled={sending} invalid={!!e.briefDoc} describedBy={e.briefDoc ? "brief-error" : "brief-hint"} onChange={setBrief} />
              {e.briefDoc && <p id="brief-error" className="text-[12.5px] text-bad">{e.briefDoc}</p>}
            </div>
            <Field label="URL Google Drive" htmlFor="driveUrl" error={e.driveUrl} hint="Tautan folder/file Google Drive atau Docs. Pastikan izin berbagi sudah dibuka untuk tim DTIC." className="sm:col-span-2">
              <div className="relative">
                <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
                <Input id="driveUrl" name="driveUrl" type="url" inputMode="url" maxLength={2000} placeholder="https://drive.google.com/…" className="h-11 pl-9" invalid={!!e.driveUrl} />
              </div>
            </Field>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <p className="text-[13px] font-medium text-ink">Dokumen pendukung <span className="font-normal text-ink-3">(opsional)</span></p>
              <label
                htmlFor="attachments"
                onDragOver={(ev) => { ev.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(ev) => { ev.preventDefault(); setDragging(false); addFiles(ev.dataTransfer.files); }}
                className={cn("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors duration-200 motion-reduce:transition-none focus-within:ring-3 focus-within:ring-accent/25", dragging ? "border-brand-emerald bg-brand-mint" : "border-line-strong bg-subtle hover:border-brand-emerald/60 hover:bg-brand-mint/60")}
              >
                <span className={cn("flex size-11 items-center justify-center rounded-xl transition-colors", dragging ? "bg-brand-emerald text-white" : "bg-surface text-brand-emerald shadow-card")}><Upload className="size-5" aria-hidden="true" /></span>
                <span className="mt-2 text-sm font-medium text-ink">Pilih file</span>
                <span className="mt-0.5 text-xs text-ink-3">{ALLOWED_EXTENSIONS_LABEL} · maks. {formatFileSize(UPLOAD_LIMITS.maxFileSizeBytes)}/file, {UPLOAD_LIMITS.maxFiles} file</span>
                <input
                  id="attachments"
                  type="file"
                  multiple
                  accept={ACCEPT_ATTRIBUTE}
                  className="sr-only"
                  aria-describedby={e.attachments ? "attachments-error" : undefined}
                  onChange={(ev) => {
                    addFiles(ev.target.files);
                    ev.target.value = "";
                  }}
                />
              </label>
              {e.attachments && <p id="attachments-error" className="text-[12.5px] text-bad">{e.attachments}</p>}
              {files.length > 0 && (
                <ul className="divide-y divide-line rounded-xl border border-line" aria-label="File terpilih">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${f.size}`} className="flex items-center gap-3 px-3 py-2.5">
                      <FileText className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{f.name}</span>
                      <span className="text-xs text-ink-3">{formatFileSize(f.size)}</span>
                      <span className="hidden text-xs text-ink-3 sm:inline">{sending ? (phase.kind === "sending" && phase.progress >= 100 ? "Terkirim" : "Mengunggah…") : "Siap diunggah"}</span>
                      <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} disabled={sending} className="rounded p-1 text-ink-3 hover:bg-subtle hover:text-bad disabled:opacity-40" aria-label={`Hapus ${f.name}`}>
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                  <li className="flex items-center gap-2 px-3 py-2 text-xs text-ink-3"><Paperclip className="size-3.5" aria-hidden="true" /> {files.length} file · {formatFileSize(totalSize)}</li>
                </ul>
              )}
            </div>
          </fieldset>
        </section>

        {/* Langkah 3 — Tim, PIC, prioritas, dan deadline */}
        <section hidden={step !== 2} className={"step-panel flex flex-col gap-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-8" + (step !== 2 ? " hidden" : "")} aria-labelledby="step-2-title">
          <header>
            <h2 id="step-2-title" className="text-lg font-semibold tracking-tight text-ink">Tim, PIC, dan deadline</h2>
            <p className="mt-1 text-sm text-ink-3">Pilih satu atau lebih PIC dari tim kategori, lalu tentukan tanggal dan jam deadline (WIB).</p>
          </header>
          <fieldset disabled={sending} className="grid gap-5 sm:grid-cols-2">
            <legend className="sr-only">Tim, PIC, dan deadline</legend>
            {team ? (
              <fieldset className="rounded-xl border border-line bg-subtle p-4 sm:col-span-2" data-testid="team-panel" aria-describedby="pic-help">
                <legend className="sr-only">Pilih anggota tim {team.name}</legend>
                <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Tim penanggung jawab</p>
                <p className="mt-1 text-sm font-semibold text-ink">{team.name}</p>
                {team.members.length > 0 ? (
                  <>
                    <p className="mt-1 text-sm text-ink-2">Pilih anggota yang akan menerima request ini. Boleh lebih dari satu orang.</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {team.members.map((m) => (
                        <label key={m.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border bg-surface px-3 py-2.5 text-sm text-ink transition-colors hover:border-line-strong", picIds.includes(m.id) ? "border-accent ring-1 ring-accent/30" : "border-line")}>
                          <input type="checkbox" name="picIds" value={m.id} checked={picIds.includes(m.id)} onChange={(ev) => setPicIds((cur) => (ev.target.checked ? [...cur, m.id] : cur.filter((id) => id !== m.id)))} className="size-4 accent-accent" />
                          {m.name}
                        </label>
                      ))}
                    </div>
                    <p id="pic-help" className={cn("mt-2 text-xs", e.picIds ? "text-bad" : "text-ink-3")}>
                      {e.picIds ?? "Pilih minimal satu anggota tim yang sesuai dengan kebutuhan pekerjaanmu."}
                    </p>
                    {picIds.length > 0 && (
                      <p className="mt-2 text-sm text-ink" aria-live="polite" data-testid="pic-summary">
                        Dipilih: {team.members.filter((m) => picIds.includes(m.id)).map((m) => m.name).join(", ")}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-bad">Tim ini belum memiliki anggota aktif. Hubungi tim DTIC.</p>
                )}
              </fieldset>
            ) : (
              <p className="rounded-xl bg-subtle p-4 text-sm text-ink-3 sm:col-span-2">Kembali ke langkah 1 dan pilih kategori pekerjaan untuk memilih PIC.</p>
            )}
            <Field label="Tanggal deadline" htmlFor="deadline" required error={e.deadline} hint="Tanggal desain dibutuhkan (WIB)">
              <Input id="deadline" name="deadline" type="date" required min={minDeadline} onFocus={() => setMinDeadline(toDateKey(new Date()))} invalid={!!e.deadline} className="h-11" />
            </Field>
            <Field label="Jam deadline" htmlFor="deadlineTime" error={e.deadlineTime} hint="Kosongkan untuk akhir hari (23.59 WIB).">
              <Input id="deadlineTime" name="deadlineTime" type="time" step={900} invalid={!!e.deadlineTime} className="h-11" />
            </Field>
            <Field label="Prioritas" htmlFor="priority" required error={e.priority} hint="Tingkat urgensi request">
              <Select id="priority" name="priority" defaultValue={defaultPriority} invalid={!!e.priority} className="h-11">
                {priorities.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </Select>
            </Field>
          </fieldset>
        </section>

        {/* Langkah 4 — Tinjau pengajuan: kartu terkelompok dari state form (bukan data contoh). */}
        <section hidden={step !== 3} className={"step-panel flex flex-col gap-6" + (step !== 3 ? " hidden" : "")} aria-labelledby="step-3-title">
          <header className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f766e,#10b981)] text-white shadow-card">
              <ClipboardCheck className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <span className="inline-flex items-center rounded-full bg-brand-mint px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-brand-deep ring-1 ring-brand-emerald/30">Langkah Terakhir</span>
              <h2 id="step-3-title" className="mt-1.5 text-xl font-semibold tracking-tight text-ink sm:text-2xl">Tinjau Pengajuan</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-3">Periksa kembali detail pekerjaan sebelum dikirim. Anda masih dapat kembali untuk mengubah isian tanpa kehilangan data.</p>
            </div>
          </header>

          {summary && (
            <>
              {/* Ringkasan pekerjaan: fokus utama, judul paling menonjol. */}
              <div className="form-rise relative overflow-hidden rounded-2xl border border-brand-emerald/30 bg-[linear-gradient(135deg,#ecfdf5_0%,#f0fdfa_55%,#eff6ff_100%)] p-5 sm:p-7" data-testid="review-hero">
                <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em] text-brand-deep uppercase">
                  <FileText className="size-4" aria-hidden="true" /> Ringkasan pekerjaan
                </p>
                <p className="mt-3 text-xl leading-snug font-semibold break-words text-navy sm:text-2xl">{summary.title}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {summary.teamName && <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1", reviewTone.badge)}>Kategori: {summary.teamName}</span>}
                  {summary.typeName && <span className="inline-flex items-center rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-line">Jenis: {summary.typeName}</span>}
                  {summary.priorityName && <span className="inline-flex items-center rounded-full bg-brand-sky px-2.5 py-1 text-xs font-semibold text-[#1d4ed8] ring-1 ring-brand-blue/30">Prioritas: {summary.priorityName}</span>}
                </div>
                <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div className="flex flex-wrap gap-1.5"><dt className="text-ink-3">Brand:</dt><dd className="font-medium text-ink">{summary.brandName || "—"}</dd></div>
                  <div className="flex flex-wrap gap-1.5"><dt className="text-ink-3">Deadline:</dt><dd className="font-medium text-ink">{summary.deadlineDate} · {summary.deadlineTime}</dd></div>
                </dl>
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                <ReviewCard index={1} icon={UserRound} title="Informasi pemohon" tone="teal">
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <ReviewField label="Pemohon" value={summary.requesterName} />
                    <ReviewField label="Brand pemohon" value={summary.brandName} />
                  </dl>
                </ReviewCard>

                <ReviewCard index={2} icon={Briefcase} title="Detail pekerjaan" tone="blue">
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <ReviewField label="Kategori / tim" value={summary.teamName} />
                    <ReviewField label="Jenis pekerjaan" value={summary.typeName} />
                    {summary.sizeLabel && <ReviewField label="Ukuran" value={summary.sizeLabel} />}
                    <ReviewField label="Prioritas" value={summary.priorityName} />
                  </dl>
                </ReviewCard>

                <ReviewCard index={3} icon={Users} title="PIC terpilih" tone="violet">
                  {summary.pics.length > 0 ? (
                    <ul className="flex flex-wrap gap-2" aria-label="PIC terpilih">
                      {summary.pics.map((pic) => (
                        <li key={pic.id} className="flex items-center gap-2.5 rounded-xl bg-subtle px-3 py-2 ring-1 ring-line">
                          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white", avatarTone(pic.name))} aria-hidden="true">{initialsOf(pic.name)}</span>
                          <span className="text-sm font-medium text-ink">{pic.name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-bad">Belum ada PIC dipilih.</p>
                  )}
                </ReviewCard>

                <ReviewCard index={4} icon={CalendarClock} title="Deadline" tone="emerald">
                  <p className="text-lg font-semibold text-ink">{summary.deadlineDate || "—"}</p>
                  <p className="mt-0.5 text-sm text-ink-2">{summary.deadlineTime}{summary.endOfDay ? " · Akhir hari" : ""}</p>
                </ReviewCard>

                <ReviewCard index={5} icon={Link2} title="Referensi pekerjaan" tone="blue">
                  {summary.driveUrl ? (
                    <div className="flex min-w-0 flex-col gap-2">
                      <p className="text-xs text-ink-3">Tautan Google Drive</p>
                      <p className="truncate font-mono text-[12.5px] text-ink-2" title={summary.driveUrl}>{summary.driveUrl}</p>
                      <a href={summary.driveUrl} target="_blank" rel="noopener noreferrer" className="group inline-flex w-fit items-center gap-1.5 rounded-lg bg-brand-sky px-3 py-1.5 text-[13px] font-semibold text-[#1d4ed8] ring-1 ring-brand-blue/30 transition-colors hover:bg-[#dbeafe] focus-visible:ring-3 focus-visible:ring-brand-blue/30">
                        Buka Referensi <ExternalLink className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                        <span className="sr-only">(membuka tab baru)</span>
                      </a>
                    </div>
                  ) : (
                    <p className="text-sm text-ink-3">Tidak ada referensi tambahan.</p>
                  )}
                </ReviewCard>

                <ReviewCard index={6} icon={Paperclip} title={`Lampiran${summary.files.length ? ` (${summary.files.length})` : ""}`} tone="teal">
                  {summary.files.length > 0 ? (
                    <ul className="flex flex-col gap-1.5">
                      {summary.files.map((file) => (
                        <li key={`${file.name}-${file.size}`} className="flex min-w-0 items-center gap-2 text-sm">
                          <FileText className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-ink" title={file.name}>{file.name}</span>
                          <span className="shrink-0 text-xs text-ink-3">{formatFileSize(file.size)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div>
                      <p className="text-sm font-medium text-ink">Belum ada lampiran</p>
                      <p className="mt-0.5 text-[13px] text-ink-3">Pengajuan ini tidak menyertakan file tambahan.</p>
                    </div>
                  )}
                </ReviewCard>
              </div>

              <ReviewCard index={7} icon={FileText} title="Deskripsi pekerjaan" tone="teal">
                <p className="text-sm leading-relaxed whitespace-pre-line break-words text-ink-2" data-testid="review-brief">{summary.briefText || "—"}</p>
              </ReviewCard>
            </>
          )}
        </section>

        {/* Navigasi langkah */}
        <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          {step > 0 && !stepLast ? (
            <Button variant="secondary" onClick={() => goTo(step - 1)} disabled={sending} className={navBtn} icon={<ArrowLeft className="size-4" aria-hidden="true" />}>
              Kembali
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
          {!stepLast ? (
            <Button onClick={next} disabled={sending || brands.length === 0 || orderTypes.length === 0} className={`${navBtn} ${primaryBtn}`}>
              Lanjutkan <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="secondary" onClick={() => goTo(step - 1)} disabled={sending} className="min-w-44" icon={<ArrowLeft className="size-4" aria-hidden="true" />}>Kembali untuk Mengedit</Button>
              <Button type="submit" loading={sending} disabled={brands.length === 0 || orderTypes.length === 0} className={`min-w-44 ${primaryBtn}`}>
                {sending ? (phase.kind === "sending" && phase.progress > 0 && phase.progress < 100 ? `Mengirim ${phase.progress}%` : "Menyimpan…") : (<>Kirim Pengajuan <Send className="size-4" aria-hidden="true" /></>)}
              </Button>
            </div>
          )}
        </div>
        {sending && (
          <div className="h-1 overflow-hidden rounded-full bg-[#eef0f3]" role="progressbar" aria-label="Progres pengiriman" aria-valuenow={phase.kind === "sending" ? phase.progress : undefined} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(phase.kind === "sending" ? phase.progress : 0, 5)}%` }} />
          </div>
        )}
      </div>

      {/* Ringkasan samping: progres, langkah, dan panduan. Tidak berisi input. */}
      <aside className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start" aria-label="Ringkasan pengajuan">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Progres</p>
          <p className="mt-1 text-sm font-semibold text-ink">Langkah {step + 1} dari {STEP_LABELS.length}: {STEP_LABELS[step]}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Progres pengisian" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(((step + 1) / STEP_LABELS.length) * 100)}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((step + 1) / STEP_LABELS.length) * 100}%` }} />
          </div>
          <ul className="mt-4 flex flex-col gap-2 text-[13px]">
            {STEP_LABELS.map((label, i) => (
              <li key={label} className={cn("flex items-center gap-2", i === step ? "font-semibold text-accent" : i < step ? "text-ink" : "text-ink-3")}>
                {i < step ? <Check className="size-3.5" aria-hidden="true" /> : <span className="size-3.5 rounded-full ring-1 ring-current" aria-hidden="true" />}
                {i + 1}. {label}
              </li>
            ))}
          </ul>
        </div>
        {step === 3 && summary && (
          <div className="form-rise rounded-2xl border border-brand-emerald/30 bg-brand-mint p-5" data-testid="review-completeness">
            <p className="text-sm font-semibold text-brand-deep">Kelengkapan isian</p>
            <p className="mt-1 text-[13px] text-ink-2">{requiredGroups.filter(([, ok]) => ok).length} dari {requiredGroups.length} kelompok wajib terisi.</p>
            <ul className="mt-3 flex flex-col gap-1.5 text-[13px]">
              {requiredGroups.map(([label, ok]) => (
                <li key={label} className={cn("flex items-center gap-2", ok ? "text-ink" : "text-bad")}>
                  {ok ? <Check className="size-3.5 text-brand-emerald" aria-hidden="true" /> : <X className="size-3.5" aria-hidden="true" />}
                  {label}{ok ? "" : " — belum terisi"}
                </li>
              ))}
            </ul>
            {summary.deadlineDate && <p className="mt-3 text-[13px] text-ink-2">Deadline: <span className="font-medium text-ink">{summary.deadlineDate} · {summary.deadlineTime}</span></p>}
            <p className="mt-2 text-xs text-ink-3">Data masih bisa diperbaiki sebelum dikirim. Validasi akhir dilakukan server saat pengiriman.</p>
          </div>
        )}
        <div className="rounded-2xl border border-line bg-subtle p-5">
          <p className="text-sm font-semibold text-ink">Panduan singkat</p>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-4 text-[13px] leading-relaxed text-ink-2">
            <li>Judul dan deskripsi diisi terpisah.</li>
            <li>PIC dipilih dari tim kategori; boleh lebih dari satu.</li>
            <li>Jam deadline opsional. Kosong berarti akhir hari (23.59 WIB).</li>
            <li>Field bertanda <span className="text-bad">*</span> wajib diisi.</li>
          </ul>
        </div>
        <div className="flex gap-3 rounded-2xl border border-line bg-surface p-5 text-[13px] leading-relaxed text-ink-2 shadow-card">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden="true" />
          <p>Setelah pengajuan tersimpan, Anda langsung menerima nomor pekerjaan. Nomor itu ditampilkan dari sistem, bukan contoh.</p>
        </div>
      </aside>

      <SubmitConfirmDialog open={confirmOpen} busy={sending} onCancel={() => setConfirmOpen(false)} onConfirm={confirmSubmit} />
    </form>
  );
}
