import { z } from "zod";
import { DELIVERY_STAGES, HANDOVER_CHANNELS, HANDOVER_METHODS } from "@/lib/qc";

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} maksimal ${max} karakter.`)
    .transform((v) => (v === "" ? null : v))
    .nullish()
    .transform((v) => v ?? null);

const resultFileIds = z.array(z.uuid({ error: "File hasil tidak valid." })).max(10, "Maksimal 10 file hasil per penyerahan.").optional();
const resultLinkIds = z.array(z.uuid({ error: "Link hasil tidak valid." })).max(10, "Maksimal 10 link hasil per penyerahan.").optional();
const requestKey = z.uuid({ error: "Kunci permintaan tidak valid." }).optional();
const URL_RE = /^https?:\/\/[^\s]+$/i;

const optionalLink = z
  .string()
  .trim()
  .max(500, "Tautan maksimal 500 karakter.")
  .refine((v) => v === "" || URL_RE.test(v), "Tautan harus diawali http:// atau https://.")
  .transform((v) => (v === "" ? null : v))
  .nullish()
  .transform((v) => v ?? null);


/** Aksi penyerahan hasil & QC. Status baru TIDAK dikirim klien; server menentukannya dari aksi. */
export const workflowActionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("submit_qc"),
    method: z.enum(HANDOVER_METHODS, { error: "Pilih cara hasil diserahkan." }),
    /** Hanya untuk metode external. */
    channel: z.enum(HANDOVER_CHANNELS, { error: "Media penyerahan tidak valid." }).optional(),
    recipient: text("Penerima", 120),
    /** Waktu penyerahan sebenarnya (bila diketahui); berbeda dengan waktu pencatatan. */
    handedAt: z.iso.datetime({ offset: true, error: "Waktu penyerahan tidak valid." }).optional(),
    stage: z.enum(DELIVERY_STAGES, { error: "Tahap tidak valid." }).optional(),
    link: optionalLink,
    resultFileIds,
    resultLinkIds,
    note: text("Catatan", 1000),
    requestKey,
  }),
  z.strictObject({ action: z.literal("withdraw_qc"), note: text("Catatan", 1000), requestKey }),
  z.strictObject({ action: z.literal("approve_qc"), note: text("Catatan", 1000), requestKey }),
  z.strictObject({
    action: z.literal("request_access"),
    note: z.string({ error: "Tulis file atau akses yang dibutuhkan." }).trim().min(1, "Tulis file atau akses yang dibutuhkan.").max(1000, "Catatan maksimal 1000 karakter."),
    requestKey,
  }),
  z.strictObject({
    action: z.literal("request_revision"),
    note: z.string({ error: "Instruksi revisi wajib diisi." }).trim().min(1, "Instruksi revisi wajib diisi.").max(1000, "Instruksi revisi maksimal 1000 karakter."),
    requestKey,
  }),
  z.strictObject({
    action: z.literal("record_delivery"),
    /** Pernyataan eksplisit PIC bahwa hasil benar-benar sudah dikirim (membuka WhatsApp saja tidak cukup). */
    confirmSent: z.boolean({ error: "Konfirmasi pengiriman wajib." }),
    stage: z.enum(DELIVERY_STAGES, { error: "Tahap tidak valid." }).optional(),
    channel: z.enum(HANDOVER_CHANNELS, { error: "Media penyerahan tidak valid." }).optional(),
    link: optionalLink,
    resultFileIds,
    resultLinkIds,
    note: text("Catatan pengiriman", 1000),
    sentAt: z.iso.datetime({ offset: true, error: "Waktu pengiriman tidak valid." }).optional(),
    requestKey,
  }),
  z.strictObject({
    action: z.literal("record_feedback"),
    needsRevision: z.boolean({ error: "Tentukan apakah pemohon meminta revisi." }),
    note: z.string({ error: "Ringkasan masukan pemohon wajib diisi." }).trim().min(1, "Ringkasan masukan pemohon wajib diisi.").max(1000, "Ringkasan maksimal 1000 karakter."),
    requestKey,
  }),
  z.strictObject({ action: z.literal("complete"), note: text("Catatan penyelesaian", 1000), link: optionalLink, resultFileIds, resultLinkIds, requestKey }),
]);
export type WorkflowActionInput = z.output<typeof workflowActionSchema>;
