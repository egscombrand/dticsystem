"use client";

import { Download, ExternalLink, MessageCircle, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import {
  composeWaMessage,
  isValidWaNumber,
  missingInput,
  waTemplateOptions,
  WA_TEMPLATE_LABEL,
  waUrl,
  type WaContext,
  type WaInputs,
  type WaTemplate,
} from "@/lib/smart-whatsapp";
import { formatWhatsappDisplay } from "@/lib/whatsapp";

/**
 * Tombol "Hubungi via WhatsApp" + dialog "Pesan WhatsApp". Pesan disusun dari data aktual pekerjaan
 * (src/lib/smart-whatsapp.ts) dan dapat diedit. Membuka WhatsApp hanya menyiapkan pesan; PIC sendiri yang
 * menekan kirim. Peristiwa "WhatsApp dibuka" dicatat tanpa isi pesan dan TIDAK berarti pesan terkirim.
 */
export function WhatsappMessageButton({
  orderId,
  number,
  requesterName,
  orderNumber,
  title,
  statusLabel,
  senderName,
  context,
  contextLabel,
  resultFiles,
}: {
  orderId: string;
  number: string | null;
  requesterName: string | null;
  orderNumber: string;
  title: string;
  statusLabel: string;
  senderName: string;
  context: WaContext;
  contextLabel: string;
  resultFiles: { id: string; fileName: string }[];
}) {
  const uid = useId();
  const { options, preferred } = waTemplateOptions(context);
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<WaTemplate | null>(preferred);
  const [inputs, setInputs] = useState<WaInputs>({ clarification: "", progressNote: "", holdReason: context.holdReason ?? "", revisionNote: context.requesterRevision ?? "" });
  const [text, setText] = useState("");
  const [edited, setEdited] = useState(false);
  const [opened, setOpened] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [firstContact, setFirstContact] = useState(context.firstContact);

  const validNumber = isValidWaNumber(number);
  const data = (now: Date) => ({ requesterName, senderName, title, orderNumber, now });
  const ctxFor = (fc: boolean) => ({ shareableLink: context.shareableLink, resultFileCount: context.resultFileCount, firstContact: fc, delivery: context.delivery });
  const build = (t: WaTemplate | null, i: WaInputs, fc = firstContact) => (t ? composeWaMessage(t, data(new Date()), ctxFor(fc), i) : "");

  function openDialog() {
    const i = { clarification: "", progressNote: "", holdReason: context.holdReason ?? "", revisionNote: context.requesterRevision ?? "" };
    setInputs(i);
    setTemplate(preferred);
    setText(build(preferred, i));
    setEdited(false);
    setOpened(false);
    setProblem(null);
    setOpen(true);
  }

  function choose(t: WaTemplate | null) {
    setTemplate(t);
    setText(build(t, inputs));
    setEdited(false);
    setProblem(null);
  }

  function updateInput(k: keyof WaInputs, v: string) {
    const i = { ...inputs, [k]: v };
    setInputs(i);
    // Pesan yang sudah diedit tangan tidak ditimpa; gunakan "Reset ke Template" untuk menyusun ulang.
    if (!edited) setText(build(template, i));
  }

  function launch() {
    setProblem(null);
    if (!validNumber) return setProblem("Nomor WhatsApp pemohon tidak tersedia atau tidak valid.");
    const need = template && !edited ? missingInput(template, inputs) : null;
    if (need) return setProblem(need);
    if (!text.trim()) return setProblem("Isi pesan masih kosong.");
    if (text.includes("…")) return setProblem("Masih ada bagian pesan yang belum diisi (tanda …).");
    // Buka lebih dulu (dalam gestur klik) agar tidak diblokir browser; pencatatan menyusul.
    window.open(waUrl(number, text), "_blank", "noopener,noreferrer");
    setOpened(true);
    setFirstContact(false);
    void fetch(`/api/internal/orders/${orderId}/whatsapp-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DTIC-Request": "1" },
      body: JSON.stringify({ template, edited, requestKey: crypto.randomUUID() }),
      keepalive: true,
    }).catch(() => {});
  }

  return (
    <>
      <button type="button" onClick={openDialog} className="inline-flex items-center gap-1 rounded-md border border-line-strong px-2 py-0.5 text-[13px] font-medium text-accent hover:bg-accent-soft">
        <MessageCircle className="size-3.5" aria-hidden="true" /> Hubungi via WhatsApp
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Pesan WhatsApp"
        description="Pesan disiapkan dari kondisi pekerjaan saat ini. Periksa dan edit sebelum membuka WhatsApp; Anda sendiri yang menekan kirim."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Batal</Button>
            <Button icon={<ExternalLink className="size-4" />} onClick={launch} disabled={!validNumber}>Buka WhatsApp</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-[15px]">
          <dl className="grid gap-x-4 gap-y-2 rounded-xl bg-subtle p-3 text-sm sm:grid-cols-2" data-testid="wa-context">
            <div><dt className="text-ink-2">Kepada</dt><dd className="font-medium text-ink">{requesterName || "Pemohon"} · {validNumber ? formatWhatsappDisplay(number) : <span className="text-bad">nomor tidak tersedia</span>}</dd></div>
            <div><dt className="text-ink-2">Pekerjaan</dt><dd className="font-medium break-words text-ink">{orderNumber} · {title}</dd></div>
            <div><dt className="text-ink-2">Status</dt><dd className="text-ink">{statusLabel}</dd></div>
            <div><dt className="text-ink-2">Konteks pesan</dt><dd className="text-ink">{contextLabel}</dd></div>
          </dl>
          {!validNumber && <Alert kind="warning">Nomor WhatsApp pemohon belum tersedia (pengajuan lama) atau tidak valid. Pesan tetap dapat disalin, tetapi WhatsApp tidak dapat dibuka dari sini.</Alert>}

          {options.length > 0 ? (
            <Field label="Jenis pesan" htmlFor={`${uid}-tpl`} hint={preferred ? `Disarankan: ${WA_TEMPLATE_LABEL[preferred]}` : undefined}>
              <Select id={`${uid}-tpl`} value={template ?? ""} onChange={(e) => choose((e.target.value || null) as WaTemplate | null)}>
                {options.map((o) => <option key={o} value={o}>{WA_TEMPLATE_LABEL[o]}</option>)}
                <option value="">Pesan bebas (tanpa template)</option>
              </Select>
            </Field>
          ) : (
            <p className="text-sm text-ink-2">Tidak ada template yang sesuai untuk status ini. Tulis pesan sendiri bila perlu.</p>
          )}

          {template === "clarification" && (
            <Field label="Poin yang ingin dikonfirmasi" htmlFor={`${uid}-cl`} required hint="Satu poin per baris. Hanya pertanyaan yang benar-benar perlu.">
              <Textarea id={`${uid}-cl`} value={inputs.clarification} onChange={(e) => updateInput("clarification", e.target.value)} maxLength={1000} />
            </Field>
          )}
          {template === "progress" && (
            <Field label="Catatan progres" htmlFor={`${uid}-pg`} hint="Opsional. Tulis progres yang benar-benar terjadi; kosongkan bila tidak ada.">
              <Input id={`${uid}-pg`} value={inputs.progressNote} onChange={(e) => updateInput("progressNote", e.target.value)} maxLength={300} />
            </Field>
          )}
          {template === "on_hold" && (
            <Field label="Kendala yang disampaikan" htmlFor={`${uid}-hd`} required hint="Diawali dari alasan penundaan yang tercatat. Hapus informasi internal yang tidak perlu diketahui pemohon.">
              <Input id={`${uid}-hd`} value={inputs.holdReason} onChange={(e) => updateInput("holdReason", e.target.value)} maxLength={300} />
            </Field>
          )}
          {template === "revision_received" && (
            <Field label="Catatan revisi" htmlFor={`${uid}-rv`} required hint="Diawali dari masukan pemohon yang tercatat.">
              <Textarea id={`${uid}-rv`} value={inputs.revisionNote} onChange={(e) => updateInput("revisionNote", e.target.value)} maxLength={1000} />
            </Field>
          )}

          <Field label="Isi pesan" htmlFor={`${uid}-msg`} hint={edited ? "Pesan sudah Anda edit." : "Dapat diedit. Teks *seperti ini* tampil tebal di WhatsApp."}>
            <Textarea id={`${uid}-msg`} value={text} onChange={(e) => { setText(e.target.value); setEdited(true); }} className="min-h-56 font-[inherit]" maxLength={3000} />
          </Field>
          {template && (
            <div>
              <Button variant="ghost" size="sm" icon={<RotateCcw className="size-4" />} onClick={() => { setText(build(template, inputs)); setEdited(false); }}>Reset ke Template</Button>
            </div>
          )}

          {(template === "send_result" || template === "result_ready" || template === "revision_done") && !context.shareableLink && resultFiles.length > 0 && (
            <div className="rounded-xl border border-line p-3 text-sm" data-testid="wa-files">
              <p className="font-medium text-ink">File hasil tersimpan privat di DTIC Nexus</p>
              <p className="mt-0.5 text-ink-2">Pemohon tidak dapat membuka tautan internal. Unduh file berikut lalu lampirkan sendiri di WhatsApp.</p>
              <ul className="mt-2 flex flex-col gap-1">
                {resultFiles.map((f) => (
                  <li key={f.id}><a href={`/api/internal/attachments/${f.id}`} className="inline-flex items-center gap-1.5 text-accent hover:underline"><Download className="size-4" aria-hidden="true" /> {f.fileName}</a></li>
                ))}
              </ul>
            </div>
          )}

          {problem && <p role="alert" className="text-sm text-bad">{problem}</p>}
          {opened && (
            <Alert kind="info">
              WhatsApp sudah dibuka dengan pesan ini. Pesan belum terkirim sampai Anda menekan kirim di WhatsApp.
              {template === "send_result" || template === "result_ready" || template === "revision_done" ? " Setelah hasil benar-benar terkirim, catat lewat Ajukan QC → Langsung ke Pemohon." : ""}
            </Alert>
          )}
        </div>
      </Modal>
    </>
  );
}
