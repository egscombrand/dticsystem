"use client";

import { ArrowRight, CheckCircle2, Copy, FileText, KeyRound, Link2, Paperclip, Upload, X } from "lucide-react";
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
import { formatDateTime, formatLongDate, toDateKey } from "@/lib/dates";
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
type Phase =
  | { kind: "idle" }
  | { kind: "sending"; progress: number }
  | { kind: "error"; message: string; title?: string }
  | {
      kind: "success";
      orderNumber: string;
      createdAt: string;
      deadlineAt: string;
      brandName: string;
      designType: string;
      attachmentCount: number;
    };

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
  "priority",
] as const;

const BRIEF_PLACEHOLDER = "Jelaskan kebutuhan, tujuan, detail pekerjaan, dan hasil yang diharapkan.";

const BRIEF_HINTS = ["Tujuan pekerjaan", "Isi / teks yang harus tampil", "Tahun", "Informasi wajib (logo, kontak, alamat)", "Konsep, warna, atau gaya", "Referensi & detail lain"];

/** Konfirmasi setelah penyimpanan benar-benar berhasil (dipanggil hanya dari respons 201/200 server). */
export function SubmissionReceipt({
  receipt,
  onReset,
}: {
  receipt: { orderNumber: string; createdAt: string; deadlineAt: string; brandName: string; designType: string; attachmentCount: number };
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
    <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-10" role="status" aria-live="polite">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-ok-soft">
        <CheckCircle2 className="size-6 text-ok" aria-hidden="true" />
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

function SectionTitle({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{n}</span>
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 text-[13px] text-ink-3">{desc}</p>
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
      if (res.status === 200 || res.status === 201) {
        setPhase({
          kind: "success",
          orderNumber: String(res.body.orderNumber),
          createdAt: String(res.body.createdAt),
          deadlineAt: String(res.body.deadlineAt),
          brandName: String(res.body.brandName ?? ""),
          designType: String(res.body.designType ?? ""),
          attachmentCount: Number(res.body.attachmentCount ?? 0),
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (res.body.fieldErrors && typeof res.body.fieldErrors === "object") setErrors(res.body.fieldErrors as FieldErrors);
      // 202: pengajuan tersimpan, tetapi notifikasi Telegram belum terkirim (alasan ditampilkan). Bukan sukses penuh.
      const saved = res.status === 202;
      setPhase({
        kind: "error",
        title: saved ? "Pengajuan tersimpan, notifikasi belum terkirim" : undefined,
        message: typeof res.body.error === "string" ? res.body.error : `Pengajuan gagal (HTTP ${res.status}).`,
      });
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      setConfirmOpen(false);
      setPhase({ kind: "error", message: "Koneksi terputus sebelum order tersimpan. Periksa internet Anda lalu kirim ulang — order tidak akan tercatat ganda." });
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } finally {
      inFlight.current = false;
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
  const sectionCls = "rounded-xl border border-line bg-surface p-5 shadow-card sm:p-7";

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {phase.kind === "error" && <Alert kind="error" title={phase.title ?? "Pengajuan belum tersimpan"}>{phase.message}</Alert>}
      {(brands.length === 0 || orderTypes.length === 0) && <Alert kind="error" title="Data form belum lengkap">Pengajuan belum dapat dilakukan. Hubungi tim DTIC.</Alert>}

      <section className={sectionCls}>
        <SectionTitle n={1} title="Data pemohon" desc="Siapa yang mengajukan request ini." />
        <fieldset disabled={sending} className="mt-5 grid gap-5 sm:grid-cols-2">
          <legend className="sr-only">Data pemohon</legend>
          <Field label="Nama" htmlFor="requesterName" required error={e.requesterName} hint="Nama lengkap pemohon" className="sm:col-span-2">
            <Input id="requesterName" name="requesterName" autoComplete="name" maxLength={120} required invalid={!!e.requesterName} />
          </Field>
          <Field label="Brand Pemohon" htmlFor="brandId" required error={e.brandId} hint="Brand/perusahaan Anda yang mengajukan request ke DTIC">
            <Select id="brandId" name="brandId" defaultValue="" required invalid={!!e.brandId}>
              <option value="" disabled>Pilih brand pemohon</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Departemen / Divisi" htmlFor="department" required error={e.department}>
            <Input id="department" name="department" maxLength={120} required placeholder="mis. Marketing" invalid={!!e.department} />
          </Field>
          <Field
            label="Nomor WhatsApp Aktif"
            htmlFor="requesterWhatsapp"
            required
            error={e.requesterWhatsapp}
            hint="Nomor WhatsApp aktif yang dapat dihubungi tim DTIC untuk konfirmasi terkait pengajuan request."
          >
            <Input
              id="requesterWhatsapp"
              name="requesterWhatsapp"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
              required
              placeholder="Contoh: 081234567890"
              invalid={!!e.requesterWhatsapp}
            />
          </Field>
        </fieldset>
      </section>

      <section className={sectionCls}>
        <SectionTitle n={2} title="Kebutuhan pekerjaan" desc="Judul, kategori, jenis, dan deskripsi pekerjaan yang diperlukan." />
        <fieldset disabled={sending} className="mt-5 grid gap-5 sm:grid-cols-2">
          <legend className="sr-only">Kebutuhan pekerjaan</legend>
          <Field label="Judul Pekerjaan" htmlFor="title" required error={e.title} hint="Tuliskan judul singkat dan jelas agar tim mudah mengenali pekerjaan yang diajukan." className="sm:col-span-2">
            <Input id="title" name="title" maxLength={160} placeholder="Contoh: Desain Poster Seminar Lingkungan 2026" required invalid={!!e.title} />
          </Field>
          <Field label="Kategori Pekerjaan" htmlFor="teamId" required error={e.teamId}>
            <Select
              id="teamId"
              name="teamId"
              value={teamId}
              onChange={(ev) => {
                setTeamId(ev.target.value);
                setPicIds([]); // anggota hanya dari tim kategori yang baru
                setDesignTypeId(""); // jenis pekerjaan mengikuti kategori
                setSizePreset("");
              }}
              required
              invalid={!!e.teamId}
            >
              <option value="" disabled>Pilih kategori</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Jenis Pekerjaan" htmlFor="designTypeId" required error={e.designTypeId}>
            <Select id="designTypeId" name="designTypeId" value={designTypeId} onChange={(ev) => setDesignTypeId(ev.target.value)} required invalid={!!e.designTypeId} disabled={!team}>
              <option value="" disabled>{team ? "Pilih jenis pekerjaan" : "Pilih kategori dulu"}</option>
              {typesForTeam.map((t) => <option key={t.id} value={t.id}>{t.requiresDetail ? `${t.name} (tulis sendiri)` : t.name}</option>)}
            </Select>
          </Field>
          {team && (
            <fieldset className="rounded-xl border border-line bg-subtle p-4 sm:col-span-2" data-testid="team-panel" aria-describedby="pic-help">
              <legend className="sr-only">Pilih anggota tim {team.name}</legend>
              <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Tim penanggung jawab</p>
              <p className="mt-1 text-sm font-semibold text-ink">{team.name}</p>
              {team.members.length > 0 ? (
                <>
                  <p className="mt-1 text-sm text-ink-2">Pilih anggota yang akan menerima request ini. Kamu dapat memilih lebih dari satu orang.</p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {team.members.map((m) => (
                      <label key={m.id} className="flex items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          name="picIds"
                          value={m.id}
                          checked={picIds.includes(m.id)}
                          onChange={(ev) => setPicIds((cur) => (ev.target.checked ? [...cur, m.id] : cur.filter((id) => id !== m.id)))}
                          className="size-4 accent-accent"
                        />
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
          )}
          {isDesign ? (
            <Field label="Ukuran" htmlFor="sizePreset" required error={e.sizePreset}>
              <Select id="sizePreset" name="sizePreset" value={sizePreset} onChange={(ev) => setSizePreset(ev.target.value)} required invalid={!!e.sizePreset}>
                <option value="" disabled>Pilih ukuran</option>
                {DESIGN_SIZE_PRESETS.filter((s) => s.value !== "na").map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            </Field>
          ) : (
            team && <input type="hidden" name="sizePreset" value="na" />
          )}
          {requiresDetail && (
            <Field label="Sebutkan jenis desain" htmlFor="designTypeOther" required error={e.designTypeOther} className="sm:col-span-2">
              <Input id="designTypeOther" name="designTypeOther" maxLength={60} placeholder="mis. Desain merchandise kaos" autoFocus invalid={!!e.designTypeOther} />
            </Field>
          )}
          {sizePreset === "custom" && (
            <div className="grid grid-cols-2 gap-4 sm:col-span-2">
              <Field label="Lebar (cm)" htmlFor="customWidth" required error={e.customWidth}>
                <Input id="customWidth" name="customWidth" inputMode="decimal" placeholder="mis. 60" invalid={!!e.customWidth} />
              </Field>
              <Field label="Tinggi (cm)" htmlFor="customHeight" required error={e.customHeight}>
                <Input id="customHeight" name="customHeight" inputMode="decimal" placeholder="mis. 160" invalid={!!e.customHeight} />
              </Field>
            </div>
          )}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="brief" className="text-[13px] font-medium text-ink" onClick={() => document.getElementById("brief")?.focus()}>
              Deskripsi Pekerjaan<span className="ml-0.5 text-bad" aria-hidden="true">*</span>
            </label>
            <div id="brief-hint" className="rounded-lg bg-subtle px-3 py-2.5 text-[12.5px] text-ink-3">
              Tuliskan brief selengkap mungkin. Sebaiknya mencakup:
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {BRIEF_HINTS.map((h) => (
                  <li key={h} className="rounded-full bg-surface px-2 py-0.5 text-ink-2 ring-1 ring-line">{h}</li>
                ))}
              </ul>
            </div>
            <RichTextEditor
              key={formKey}
              id="brief"
              placeholder={BRIEF_PLACEHOLDER}
              disabled={sending}
              invalid={!!e.briefDoc}
              describedBy={e.briefDoc ? "brief-error" : "brief-hint"}
              onChange={setBrief}
            />
            {e.briefDoc && <p id="brief-error" className="text-[12.5px] text-bad">{e.briefDoc}</p>}
          </div>
        </fieldset>
      </section>

      <section className={sectionCls}>
        <SectionTitle n={3} title="Dokumen, deadline, prioritas & PIC" desc="Lampirkan file atau tautan Google Drive, tentukan tanggal, urgensi, dan member DTIC yang cocok." />
        <fieldset disabled={sending} className="mt-5 grid gap-5">
          <legend className="sr-only">Dokumen dan deadline</legend>
          <div>
            <p className="text-[13px] font-medium text-ink">
              Dokumen pendukung <span className="font-normal text-ink-3">(opsional)</span>
            </p>
            <label
              htmlFor="attachments"
              className="mt-1.5 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-subtle px-4 py-6 text-center transition-colors hover:border-accent hover:bg-accent-soft/40 has-[:focus-visible]:border-accent has-[:disabled]:cursor-not-allowed"
            >
              <Upload className="size-5 text-ink-3" aria-hidden="true" />
              <span className="mt-2 text-sm font-medium text-ink">Pilih file</span>
              <span className="mt-0.5 text-xs text-ink-3">
                {ALLOWED_EXTENSIONS_LABEL} · maks. {formatFileSize(UPLOAD_LIMITS.maxFileSizeBytes)}/file, {UPLOAD_LIMITS.maxFiles} file
              </span>
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
            {e.attachments && <p id="attachments-error" className="mt-1.5 text-[12.5px] text-bad">{e.attachments}</p>}
            {files.length > 0 && (
              <ul className="mt-3 divide-y divide-line rounded-lg border border-line" aria-label="File terpilih">
                {files.map((f, i) => (
                  <li key={`${f.name}-${f.size}`} className="flex items-center gap-3 px-3 py-2">
                    <FileText className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{f.name}</span>
                    <span className="text-xs text-ink-3">{formatFileSize(f.size)}</span>
                    <span className="hidden text-xs text-ink-3 sm:inline">
                      {sending ? (phase.kind === "sending" && phase.progress >= 100 ? "Terkirim" : "Mengunggah…") : "Siap diunggah"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      disabled={sending}
                      className="rounded p-1 text-ink-3 hover:bg-subtle hover:text-bad disabled:opacity-40"
                      aria-label={`Hapus ${f.name}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
                <li className="flex items-center gap-2 px-3 py-2 text-xs text-ink-3">
                  <Paperclip className="size-3.5" aria-hidden="true" /> {files.length} file · {formatFileSize(totalSize)}
                </li>
              </ul>
            )}
          </div>
          <Field
            label="URL Google Drive"
            htmlFor="driveUrl"
            error={e.driveUrl}
            hint="Tautan folder/file Google Drive atau Docs. Pastikan izin berbagi sudah dibuka untuk tim DTIC — sistem hanya menyimpan tautannya."
          >
            <div className="relative">
              <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
              <Input id="driveUrl" name="driveUrl" type="url" inputMode="url" maxLength={2000} placeholder="https://drive.google.com/…" className="pl-9" invalid={!!e.driveUrl} />
            </div>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Deadline" htmlFor="deadline" required error={e.deadline} hint="Tanggal desain dibutuhkan (sampai akhir hari, WIB)">
              <Input id="deadline" name="deadline" type="date" required min={minDeadline} onFocus={() => setMinDeadline(toDateKey(new Date()))} invalid={!!e.deadline} />
            </Field>
            <Field label="Prioritas" htmlFor="priority" required error={e.priority} hint="Tingkat urgensi request">
              <Select id="priority" name="priority" defaultValue={defaultPriority} invalid={!!e.priority}>
                {priorities.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </Select>
            </Field>
          </div>
        </fieldset>
      </section>

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-3">
          Field bertanda <span className="text-bad">*</span> wajib diisi. Waktu pengajuan dan nomor order dicatat otomatis.
        </p>
        <Button type="submit" loading={sending} disabled={brands.length === 0 || orderTypes.length === 0} className="sm:min-w-44">
          {sending ? (phase.kind === "sending" && phase.progress > 0 && phase.progress < 100 ? `Mengirim ${phase.progress}%` : "Menyimpan…") : "Kirim pengajuan"}
        </Button>
      </div>
      {sending && (
        <div className="h-1 overflow-hidden rounded-full bg-[#eef0f3]" role="progressbar" aria-label="Progres pengiriman" aria-valuenow={phase.progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.max(phase.progress, 5)}%` }} />
        </div>
      )}
      <SubmitConfirmDialog open={confirmOpen} busy={sending} onCancel={() => setConfirmOpen(false)} onConfirm={confirmSubmit} />
    </form>
  );
}
