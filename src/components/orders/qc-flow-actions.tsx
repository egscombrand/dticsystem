"use client";

import { CheckCircle2, ExternalLink, FileUp, FolderOpen, KeyRound, MessageCircle, MessageSquareReply, Paperclip, Send, ShieldCheck, Undo2, UserCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { ApiError, internalRequest } from "@/lib/client/api";
import { ACTION_LABEL, COMPLETION_NOTE_MIN, DELIVERY_STAGE_LABEL, EXTERNAL_NOTE_MIN, HANDOVER_CHANNEL_LABEL, HANDOVER_CHANNELS, QC_STATUS_LABEL, type DeliveryStage, type HandoverChannel, type QcStatus, type WorkflowAction } from "@/lib/qc";
import { formatWhatsappDisplay, whatsappLink } from "@/lib/whatsapp";
import { formatFileSize } from "@/lib/files";
import { ResultUploader, type UploadedResult } from "@/components/orders/result-uploader";

export type ExistingResult = { id: string; fileName: string; fileSize: number; statusLabel: string };

type Dialog = "handover" | Exclude<WorkflowAction, "submit_qc" | "record_delivery"> | null;
type Destination = "manager" | "requester";
/** Cara melampirkan file hasil (opsional): pilih yang sudah ada, unggah baru, atau tanpa lampiran. */
type AttachMode = "existing" | "upload" | "none";

const URL_RE = /^https?:\/\/\S+$/i;

/** datetime-local (WIB) → ISO; kosong = tidak diketahui (tidak diisi otomatis dengan waktu sekarang). */
const wibToIso = (v: string) => (v ? new Date(`${v}:00+07:00`).toISOString() : undefined);

/**
 * Tombol & dialog penyerahan hasil, QC, dan penyelesaian. Daftar aksi dihitung server
 * (availableWorkflowActions); server memeriksa ulang setiap permintaan. Kunci permintaan dipertahankan
 * selama dialog terbuka, sehingga klik ganda atau mengulang setelah timeout tidak menggandakan catatan.
 */
export function QcFlowActions({
  orderId,
  orderTitle,
  orderNumber,
  actions,
  qcStatus,
  requester,
  managerNames,
  lastLink,
  completionNeedsNote,
  maxResultBytes,
  existingResults,
  defaultResultIds,
}: {
  orderId: string;
  orderTitle: string;
  orderNumber: string;
  actions: WorkflowAction[];
  qcStatus: QcStatus;
  requester: { name: string; whatsapp: string | null };
  managerNames: string[];
  lastLink: string | null;
  completionNeedsNote: boolean;
  maxResultBytes: number;
  existingResults: ExistingResult[];
  /** File dari penyerahan/persetujuan terakhir: dipilih otomatis sebagai referensi. */
  defaultResultIds: string[];
}) {
  const router = useRouter();
  const uid = useId();
  const keyRef = useRef("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);

  const [dest, setDest] = useState<Destination | null>(null);
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [stage, setStage] = useState<DeliveryStage | "">("");
  const [handedAt, setHandedAt] = useState("");
  const [confirmSent, setConfirmSent] = useState(false);
  const [needsRevision, setNeedsRevision] = useState<boolean | null>(null);

  const [attachMode, setAttachMode] = useState<AttachMode>("none");
  const [channel, setChannel] = useState<HandoverChannel | "">("");
  const [recipient, setRecipient] = useState("");
  const [uploaded, setUploaded] = useState<UploadedResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [uploaderKey, setUploaderKey] = useState(0);
  const resultIds = attachMode === "existing" ? [...picked] : attachMode === "upload" ? uploaded.map((u) => u.id) : [];

  const canManager = actions.includes("submit_qc");
  const canRequester = actions.includes("record_delivery");

  function open(next: Exclude<Dialog, null>) {
    keyRef.current = crypto.randomUUID();
    setError(null);
    setFieldError({});
    setFlash(null);
    setNote("");
    setLink(next === "handover" || next === "complete" ? (lastLink ?? "") : "");
    setStage("");
    setHandedAt("");
    setConfirmSent(false);
    setNeedsRevision(null);
    setUploaded([]);
    setUploading(false);
    setChannel("");
    setRecipient("");
    const defaults = defaultResultIds.filter((id) => existingResults.some((r) => r.id === id));
    setPicked(new Set(defaults));
    setAttachMode(defaults.length > 0 ? "existing" : "none");
    setUploaderKey((k) => k + 1);
    setDest(next === "handover" && canManager !== canRequester ? (canManager ? "manager" : "requester") : null);
    setDialog(next);
  }

  function close() {
    if (!busy) setDialog(null);
  }

  async function submit() {
    if (!dialog) return;
    setBusy(true);
    setError(null);
    setFieldError({});
    let body: Record<string, unknown>;
    let done: string;
    if (dialog === "handover") {
      const common = { link: link.trim() || undefined, note: note.trim() || undefined, stage: stage || undefined };
      body =
        dest === "manager"
          ? resultIds.length > 0
            ? { action: "submit_qc", method: "in_app", resultFileIds: resultIds, handedAt: wibToIso(handedAt), ...common }
            : { action: "submit_qc", method: "external", channel: channel || undefined, recipient: recipient.trim() || undefined, handedAt: wibToIso(handedAt), ...common }
          : { action: "record_delivery", confirmSent, channel: channel || undefined, resultFileIds: resultIds, sentAt: wibToIso(handedAt), ...common };
      done = dest === "manager" ? "Hasil diajukan ke Manager untuk diperiksa." : "Penyerahan ke pemohon tercatat.";
    } else if (dialog === "record_feedback") {
      body = { action: dialog, needsRevision, note: note.trim() };
      done = "Masukan pemohon tercatat.";
    } else if (dialog === "complete") {
      body = { action: dialog, note: note.trim() || undefined, link: link.trim() || undefined, resultFileIds: resultIds };
      done = "Pekerjaan diselesaikan.";
    } else {
      body = { action: dialog, note: note.trim() || undefined };
      done = `${ACTION_LABEL[dialog]} berhasil.`;
    }
    try {
      await internalRequest(`/api/internal/orders/${orderId}/workflow`, "POST", { ...body, requestKey: keyRef.current });
      setDialog(null);
      setFlash(done);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.fieldErrors) setFieldError(err.fieldErrors as Record<string, string>);
      } else setError("Permintaan belum tersimpan. Coba lagi; catatan tidak akan tergandakan.");
    } finally {
      setBusy(false);
    }
  }

  const canConfirm = (() => {
    if (busy || !dialog || uploading) return false;
    const linkOk = link.trim() === "" || URL_RE.test(link.trim());
    if (dialog === "handover") {
      if (dest === "manager") {
        if (!linkOk) return false;
        // Dengan lampiran → file di DTIC Nexus; tanpa lampiran → keterangan penyerahan di luar aplikasi wajib.
        return resultIds.length > 0 || (channel !== "" && note.trim().length >= EXTERNAL_NOTE_MIN);
      }
      if (dest === "requester") return confirmSent && linkOk;
      return false;
    }
    if (dialog === "request_revision" || dialog === "request_access") return note.trim().length > 0;
    if (dialog === "record_feedback") return needsRevision !== null && note.trim().length > 0;
    if (dialog === "complete") return (!completionNeedsNote || note.trim().length >= COMPLETION_NOTE_MIN) && linkOk;
    return true;
  })();

  const titles: Record<Exclude<Dialog, null>, { title: string; description: string; confirm: string }> = {
    handover: { title: "Pilih Tujuan Penyerahan Hasil", description: "Catat penyerahan hasil sesuai tujuan sebenarnya. File tidak harus diunggah ulang jika sudah diserahkan melalui media lain.", confirm: dest === "requester" ? "Konfirmasi Penyerahan" : dest === "manager" ? "Ajukan QC" : "Pilih tujuan" },
    withdraw_qc: { title: "Tarik pengajuan QC?", description: "Pengajuan dibatalkan dan pekerjaan kembali ke Sedang Dikerjakan. Riwayat pengajuan tetap tersimpan.", confirm: "Tarik Pengajuan" },
    approve_qc: { title: "Setujui hasil?", description: "Persetujuan tercatat atas nama Anda. PIC dapat melanjutkan pengiriman ke pemohon atau menyelesaikan pekerjaan.", confirm: "Ya, Setujui" },
    request_access: { title: "Minta file atau akses", description: "Gunakan bila hasil belum dapat diperiksa (file belum diterima atau tidak bisa dibuka). Pengajuan dikembalikan ke PIC tanpa keputusan atas hasil.", confirm: "Kirim Permintaan" },
    request_revision: { title: "Minta revisi", description: "Tulis apa yang perlu diperbaiki agar PIC tidak perlu menebak. Pekerjaan kembali ke PIC.", confirm: "Kirim Permintaan Revisi" },
    record_feedback: { title: "Catat masukan pemohon", description: "Ringkas tanggapan pemohon (mis. dari WhatsApp). Tanpa pencatatan, sistem tidak menganggap pemohon menyetujui hasil.", confirm: "Simpan Masukan" },
    complete: {
      title: "Selesaikan Pekerjaan?",
      description: "Pastikan pekerjaan ini sudah selesai. Jika penyelesaian telah dibahas atau disepakati di luar aplikasi, kamu dapat mencatatnya di sini agar status dan riwayat pekerjaan tetap akurat.",
      confirm: "Ya, Selesaikan",
    },
  };
  const t = dialog ? titles[dialog] : null;

  const primary = actions.filter((a) => a !== "record_delivery");

  const selectedCount = resultIds.length;
  const resultsBlock = (
    <section className="flex flex-col gap-3 rounded-xl border border-line p-4" aria-labelledby={`${uid}-att`} data-testid="attachments">
      <div>
        <h3 id={`${uid}-att`} className="flex items-center gap-2 text-sm font-semibold text-ink"><Paperclip className="size-4 text-ink-2" aria-hidden="true" /> Lampiran hasil (opsional)</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">Jika file sudah dikirim melalui WhatsApp, email, atau media lain, Anda tidak perlu mengunggahnya kembali. Lampirkan file di sini hanya jika perlu menyimpan salinan di DTIC Nexus.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cara melampirkan file">
        {([
          ["existing", "Pilih file yang sudah ada", FolderOpen, existingResults.length > 0],
          ["upload", "Unggah file baru", FileUp, true],
          ["none", "Tidak melampirkan file", null, true],
        ] as const).filter(([, , , show]) => show).map(([v, label, Icon]) => (
          <label key={v} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium", attachMode === v ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink-2 hover:border-accent")}>
            <input type="radio" name={`${uid}-attach`} className="sr-only" checked={attachMode === v} onChange={() => setAttachMode(v)} disabled={busy} />
            {Icon && <Icon className="size-4" aria-hidden="true" />} {label}
          </label>
        ))}
      </div>
      {attachMode === "existing" && (
        <fieldset className="flex flex-col gap-1.5" disabled={busy}>
          <legend className="sr-only">File yang sudah tersimpan</legend>
          {existingResults.map((r) => (
            <label key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-subtle">
              <input type="checkbox" className="size-4 accent-[#0f766e]" checked={picked.has(r.id)} onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
              <span className="min-w-0 flex-1 truncate" title={r.fileName}>{r.fileName}</span>
              <span className="shrink-0 text-xs text-ink-2">{formatFileSize(r.fileSize)} · {r.statusLabel}</span>
            </label>
          ))}
        </fieldset>
      )}
      {/* Uploader tetap terpasang (agar unggahan berjalan tidak hilang), hanya ditampilkan pada mode unggah. */}
      <div className={attachMode === "upload" ? "" : "hidden"}>
        <ResultUploader key={uploaderKey} orderId={orderId} maxBytes={maxResultBytes} disabled={busy} onChange={(list, isBusy) => { setUploaded(list); setUploading(isBusy); }} />
        <p className="mt-2 text-xs text-ink-2">File baru tersimpan privat sebagai draf sampai Anda mengonfirmasi. Menyimpan file belum berarti hasil sudah diserahkan.</p>
      </div>
      <p className="text-[13px] text-ink-2" data-testid="attachments-summary">{selectedCount > 0 ? `${selectedCount} file akan dikaitkan dengan penyerahan ini.` : "Tidak ada file yang dilampirkan."}</p>
    </section>
  );

  return (
    <div className="flex flex-col gap-3">
      {flash && <Alert kind="success">{flash}</Alert>}
      <div className="flex flex-col gap-2" data-testid="qc-actions">
        {primary.map((a) => {
          if (a === "submit_qc") return (
            <Button key={a} icon={<Send className="size-4" />} onClick={() => open("handover")} className="w-full justify-center">{ACTION_LABEL.submit_qc}</Button>
          );
          if (a === "approve_qc") return <Button key={a} icon={<ShieldCheck className="size-4" />} onClick={() => open("approve_qc")} className="w-full justify-center">{ACTION_LABEL.approve_qc}</Button>;
          if (a === "request_access") return <Button key={a} variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => open("request_access")} className="w-full justify-center">{ACTION_LABEL.request_access}</Button>;
          if (a === "request_revision") return <Button key={a} variant="danger" icon={<Undo2 className="size-4" />} onClick={() => open("request_revision")} className="w-full justify-center">{ACTION_LABEL.request_revision}</Button>;
          if (a === "record_feedback") return <Button key={a} variant="secondary" icon={<MessageSquareReply className="size-4" />} onClick={() => open("record_feedback")} className="w-full justify-center">{ACTION_LABEL.record_feedback}</Button>;
          if (a === "withdraw_qc") return <Button key={a} variant="ghost" size="sm" icon={<Undo2 className="size-4" />} onClick={() => open("withdraw_qc")} className="justify-center">{ACTION_LABEL.withdraw_qc}</Button>;
          return <Button key={a} variant="secondary" icon={<CheckCircle2 className="size-4" />} onClick={() => open("complete")} className="w-full justify-center">{ACTION_LABEL.complete}</Button>;
        })}
        {!canManager && canRequester && (
          <Button variant="secondary" icon={<Send className="size-4" />} onClick={() => open("handover")} className="w-full justify-center">Kirim Ulang ke Pemohon</Button>
        )}
      </div>

      <Modal
        open={dialog !== null}
        onClose={close}
        size={dialog === "handover" || dialog === "complete" ? "wide" : "md"}
        title={t?.title ?? ""}
        description={t?.description}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>Batal</Button>
            <Button onClick={submit} loading={busy} disabled={!canConfirm} variant={dialog === "request_revision" ? "danger" : "primary"}>{t?.confirm}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-[15px]">
          {dialog && (
            <p className="rounded-xl bg-subtle px-3 py-2.5 text-sm text-ink-2" data-testid="qc-dialog-order">
              <span className="font-medium text-ink">{orderTitle}</span> · <span className="font-mono">{orderNumber}</span>
            </p>
          )}

          {dialog === "handover" && (
            <>
              <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy}>
                <legend className="mb-2 text-sm font-semibold text-ink">Tujuan penyerahan</legend>
                {([
                  ["manager", "Ke Manager", "Serahkan hasil untuk pemeriksaan QC oleh Manager.", Users, canManager],
                  ["requester", "Langsung ke Pemohon", "Catat penyerahan hasil langsung kepada pemohon tanpa melalui QC Manager.", UserCheck, canRequester],
                ] as const).map(([value, label, hint, Icon, enabled]) => (
                  <label key={value} className={cn("flex cursor-pointer gap-3 rounded-xl border-2 p-4 transition-colors motion-reduce:transition-none", dest === value ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong", !enabled && "cursor-not-allowed opacity-50")}>
                    <input type="radio" name={`${uid}-dest`} value={value} checked={dest === value} disabled={!enabled} onChange={() => setDest(value)} className="mt-1 accent-[#0f766e]" />
                    <span>
                      <span className="flex items-center gap-2 font-semibold text-ink"><Icon className="size-4 text-accent" aria-hidden="true" /> {label}</span>
                      <span className="mt-0.5 block text-sm text-ink-2">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {dest && (
                <section className="rounded-xl bg-subtle p-4 text-sm" aria-label="Informasi tujuan" data-testid={dest === "manager" ? "qc-manager-recipient" : "qc-whatsapp"}>
                  {dest === "manager" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <p><span className="text-ink-2">Ditujukan ke:</span> <span className="font-medium text-ink">{managerNames.length ? `Manager (${managerNames.join(", ")})` : "Manager"}</span></p>
                      <p><span className="text-ink-2">Status QC saat ini:</span> <span className="font-medium text-ink">{QC_STATUS_LABEL[qcStatus]}</span></p>
                      <p className="text-[13px] text-ink-2 sm:col-span-2">Mengajukan QC belum berarti disetujui. Manager dapat menyetujui, meminta revisi, atau meminta file/akses bila belum bisa memeriksa.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <p><span className="text-ink-2">Pemohon:</span> <span className="font-medium text-ink">{requester.name}</span></p>
                        {requester.whatsapp ? (
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-ink">{formatWhatsappDisplay(requester.whatsapp)}</span>
                            <a href={whatsappLink(requester.whatsapp)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-surface px-2 py-0.5 text-[13px] font-medium text-accent hover:bg-accent-soft">
                              <MessageCircle className="size-3.5" aria-hidden="true" /> Buka WhatsApp <ExternalLink className="size-3" aria-hidden="true" />
                            </a>
                          </p>
                        ) : (
                          <p className="text-ink-2">Nomor WhatsApp pemohon belum tersedia (pengajuan lama).</p>
                        )}
                        <p><span className="text-ink-2">Status QC:</span> <span className="font-medium text-ink">{QC_STATUS_LABEL[qcStatus]}</span></p>
                      </div>
                      <p className="text-[13px] text-ink-2">Membuka WhatsApp tidak mengirim pesan dan tidak mencatat penyerahan.{qcStatus !== "approved" ? " Penyerahan langsung tidak berarti QC Manager disetujui." : ""}</p>
                    </div>
                  )}
                </section>
              )}

              {dest && (
                <section className="flex flex-col gap-4" aria-labelledby={`${uid}-info`}>
                  <h3 id={`${uid}-info`} className="text-sm font-semibold text-ink">Informasi penyerahan</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Tahap hasil" htmlFor={`${uid}-stage`}>
                      <Select id={`${uid}-stage`} value={stage} onChange={(e) => setStage(e.target.value as DeliveryStage | "")} disabled={busy}>
                        <option value="">Tidak ditentukan</option>
                        {(Object.keys(DELIVERY_STAGE_LABEL) as DeliveryStage[]).map((v) => <option key={v} value={v}>{DELIVERY_STAGE_LABEL[v]}</option>)}
                      </Select>
                    </Field>
                    <Field label="Waktu penyerahan (WIB)" htmlFor={`${uid}-at`} error={fieldError.handedAt ?? fieldError.sentAt} hint="Kosongkan bila tidak diketahui. Waktu pencatatan disimpan terpisah.">
                      <Input id={`${uid}-at`} type="datetime-local" value={handedAt} onChange={(e) => setHandedAt(e.target.value)} disabled={busy} />
                    </Field>
                    <Field
                      label="Media penyerahan"
                      htmlFor={`${uid}-ch`}
                      required={dest === "manager" && selectedCount === 0}
                      error={fieldError.channel}
                      hint={dest === "manager" ? (selectedCount === 0 ? "Wajib bila tidak melampirkan file." : "Opsional; file dilampirkan di DTIC Nexus.") : "Opsional."}
                    >
                      <Select id={`${uid}-ch`} value={channel} onChange={(e) => setChannel(e.target.value as HandoverChannel | "")} disabled={busy}>
                        <option value="">Pilih media</option>
                        {HANDOVER_CHANNELS.map((c) => <option key={c} value={c}>{dest === "requester" && c === "direct" ? "Langsung kepada pemohon" : HANDOVER_CHANNEL_LABEL[c]}</option>)}
                      </Select>
                    </Field>
                    {dest === "manager" ? (
                      <Field label="Penerima" htmlFor={`${uid}-rcp`} hint="Bila diketahui.">
                        <Input id={`${uid}-rcp`} value={recipient} onChange={(e) => setRecipient(e.target.value)} maxLength={120} disabled={busy} />
                      </Field>
                    ) : <div className="hidden sm:block" />}
                    <Field label="Tautan eksternal yang diserahkan" htmlFor={`${uid}-link`} error={fieldError.link} hint="Opsional." className="sm:col-span-2">
                      <Input id={`${uid}-link`} type="url" inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} disabled={busy} />
                    </Field>
                    <Field
                      label="Catatan penyerahan (internal)"
                      htmlFor={`${uid}-note`}
                      required={dest === "manager" && selectedCount === 0}
                      error={fieldError.note}
                      hint={`Tidak terlihat oleh pemohon.${dest === "manager" && selectedCount === 0 ? ` Wajib (minimal ${EXTERNAL_NOTE_MIN} karakter) bila tidak melampirkan file, mis. "Sudah dikirim ke WhatsApp Manager".` : ""}`}
                      className="sm:col-span-2"
                    >
                      <Textarea id={`${uid}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} disabled={busy} className="min-h-20" />
                    </Field>
                  </div>
                </section>
              )}

              {dest && resultsBlock}

              {dest === "requester" && (
                <div className="flex flex-col gap-2">
                  <label className="flex items-start gap-2.5 rounded-xl border border-line p-3 text-sm text-ink">
                    <input type="checkbox" checked={confirmSent} onChange={(e) => setConfirmSent(e.target.checked)} disabled={busy} className="mt-0.5 size-4 accent-[#0f766e]" />
                    <span>Saya sudah benar-benar mengirim hasil ini kepada pemohon.</span>
                  </label>
                  <p className="text-[13px] text-ink-2">Belum mengirim? Tekan Batal — tidak ada penyerahan yang dicatat. File yang sudah diunggah tetap tersimpan sebagai draf.</p>
                </div>
              )}
            </>
          )}

          {dialog === "record_feedback" && (
            <fieldset className="flex flex-col gap-2" disabled={busy}>
              <legend className="mb-1 text-sm font-medium text-ink">Apakah pemohon meminta revisi?<span className="ml-0.5 text-bad" aria-hidden="true">*</span></legend>
              {([[true, "Ada revisi", "Pekerjaan kembali ke Sedang Dikerjakan."], [false, "Tidak ada revisi", "Hanya dicatat. Pekerjaan belum otomatis selesai."]] as const).map(([v, label, hint]) => (
                <label key={label} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3 text-sm", needsRevision === v ? "border-accent bg-accent-soft" : "border-line")}>
                  <input type="radio" name={`${uid}-rev`} checked={needsRevision === v} onChange={() => setNeedsRevision(v)} className="mt-1 accent-[#0f766e]" />
                  <span><span className="block font-medium text-ink">{label}</span><span className="block text-ink-2">{hint}</span></span>
                </label>
              ))}
            </fieldset>
          )}

          {dialog === "complete" && (
            <>
              {completionNeedsNote && (
                <Alert kind="info">Belum ada pengiriman yang tercatat di aplikasi. Tuliskan keterangan sesuai kondisi sebenarnya, mis. &quot;Hasil sudah dikirim melalui WhatsApp&quot; atau &quot;Penyelesaian sudah disepakati langsung&quot;. Penyelesaian tidak membuat catatan pengiriman atau persetujuan Manager.</Alert>
              )}
              {resultsBlock}
              <p className="text-[13px] text-ink-2">Upload file tidak wajib bila pekerjaan tidak menghasilkan file. Penyelesaian tidak menandai file sebagai terkirim.</p>
              <Field label="Tautan referensi hasil" htmlFor={`${uid}-clink`} error={fieldError.link} hint="Opsional.">
                <Input id={`${uid}-clink`} type="url" inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} disabled={busy} />
              </Field>
            </>
          )}

          {dialog && dialog !== "handover" && (
            <Field
              label={dialog === "request_revision" ? "Instruksi revisi" : dialog === "record_feedback" ? "Ringkasan masukan pemohon" : dialog === "complete" ? "Catatan penyelesaian" : "Catatan"}
              htmlFor={`${uid}-note`}
              required={dialog === "request_revision" || dialog === "record_feedback" || (dialog === "complete" && completionNeedsNote)}
              error={fieldError.note}
              hint={dialog === "complete" && completionNeedsNote ? `Minimal ${COMPLETION_NOTE_MIN} karakter.` : dialog === "record_feedback" ? "Catatan internal tim DTIC; tidak terlihat oleh pemohon." : undefined}
            >
              <Textarea id={`${uid}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} disabled={busy} />
            </Field>
          )}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
