import "server-only";
import { randomUUID } from "node:crypto";
import { UPLOAD_LIMITS } from "@/lib/config/app";
import { ALLOWED_FILE_TYPES, checkFileBasics, contentMatchesExtension, formatFileSize, getExtension, sanitizeFileName } from "@/lib/files";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { findSession, tokenFromRequest } from "@/lib/server/auth";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { findOrderForTracking } from "@/lib/server/repositories/orders";
import {
  addFeedbackReply,
  getFeedbackTicketByNumber,
  insertFeedbackTicket,
  listFeedbackAttachments,
  listFeedbackEvents,
  type FeedbackReporter,
  type NewFeedbackAttachment,
} from "@/lib/server/repositories/feedback";
import { storage, StorageNotConfiguredError, type FileStorage } from "@/lib/server/storage";
import { str, toFieldErrors } from "@/lib/validation/common";
import { feedbackReplySchema, feedbackSubmissionSchema, FEEDBACK_STATUS_LABEL, type FeedbackKind } from "@/lib/validation/feedback";

const LOOKUP_IP_LIMIT = 30;
const LOOKUP_WINDOW_MS = 15 * 60_000;
const TICKET_NUMBER_RE = /^FB-\d{4}-\d{5,}$/;
const normalizeTicketNumber = (v: string) => v.trim().toUpperCase().replace(/\s+/g, "");

export type PublicFeedbackView = {
  ticketNumber: string;
  kind: FeedbackKind;
  title: string;
  statusLabel: string;
  createdAt: string;
  updates: { at: string; message: string | null; kind: string }[];
  attachments: { id: string; fileName: string; mimeType: string; fileSize: number }[];
  awaitingReply: boolean;
};

/** Pencarian tiket publik — nomor tiket SATU-SATUNYA identifier, sama persis model Riwayat Request order. */
export async function lookupFeedbackTicket(request: Request, rawTicketNumber: string): Promise<PublicFeedbackView> {
  const ticketNumber = normalizeTicketNumber(rawTicketNumber);
  if (!TICKET_NUMBER_RE.test(ticketNumber)) throw new AppError("Format nomor tiket tidak valid, contoh: FB-2026-00012.", 422);
  const ip = rateLimit(`feedback-lookup:${clientIp(request)}`, LOOKUP_IP_LIMIT, LOOKUP_WINDOW_MS);
  if (!ip.ok) throw new AppError(`Terlalu banyak pencarian. Coba lagi dalam ${Math.ceil(ip.retryAfterSeconds / 60)} menit.`, 429);

  const ticket = await getFeedbackTicketByNumber(ticketNumber);
  if (!ticket) throw new NotFoundError("Nomor tiket tidak ditemukan. Periksa kembali nomor yang Anda terima saat melapor.");

  const [events, attachments] = await Promise.all([listFeedbackEvents(ticket.id, { onlyVisibleToReporter: true }), listFeedbackAttachments(ticket.id)]);
  return {
    ticketNumber: ticket.ticketNumber,
    kind: ticket.kind,
    title: ticket.title,
    statusLabel: FEEDBACK_STATUS_LABEL[ticket.status],
    createdAt: ticket.createdAt,
    updates: events.map((e) => ({ at: e.at, message: e.message, kind: e.kind })),
    attachments,
    awaitingReply: ticket.status === "need_info",
  };
}

/** Pelapor menjawab pertanyaan ('Menunggu Informasi') — murni berdasar nomor tiket, tanpa sesi. */
export async function replyToFeedbackTicket(request: Request, rawInput: { ticketNumber: unknown; message: unknown }): Promise<PublicFeedbackView> {
  const ip = rateLimit(`feedback-reply:${clientIp(request)}`, LOOKUP_IP_LIMIT, LOOKUP_WINDOW_MS);
  if (!ip.ok) throw new AppError(`Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(ip.retryAfterSeconds / 60)} menit.`, 429);
  const parsed = feedbackReplySchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("Periksa kembali isian.", 422, toFieldErrors(parsed.error));
  const ticketNumber = normalizeTicketNumber(parsed.data.ticketNumber);
  await addFeedbackReply(ticketNumber, parsed.data.message);
  return lookupFeedbackTicket(request, ticketNumber);
}

const FORM_FIELDS = ["kind", "title", "relatedPage", "detail", "impact", "relatedOrderNumber", "reporterName", "reporterContact"] as const;

type PreparedAttachment = { fileName: string; ext: string; mimeType: string; bytes: Uint8Array };

async function prepareAttachments(entries: FormDataEntryValue[]): Promise<PreparedAttachment[]> {
  const files = entries.filter((e): e is File => typeof e !== "string" && e.size > 0);
  if (files.length > UPLOAD_LIMITS.maxFiles) throw new AppError(`Maksimal ${UPLOAD_LIMITS.maxFiles} lampiran.`, 422, { attachments: `Maksimal ${UPLOAD_LIMITS.maxFiles} lampiran.` });
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > UPLOAD_LIMITS.maxTotalBytes) {
    const msg = `Total ukuran lampiran maksimal ${formatFileSize(UPLOAD_LIMITS.maxTotalBytes)}.`;
    throw new AppError(msg, 422, { attachments: msg });
  }
  const out: PreparedAttachment[] = [];
  for (const file of files) {
    const fileName = sanitizeFileName(file.name);
    const basic = checkFileBasics({ name: fileName, size: file.size });
    if (basic) throw new AppError(basic, 422, { attachments: basic });
    const ext = getExtension(fileName);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!contentMatchesExtension(ext, bytes.subarray(0, 16))) {
      const msg = `Isi file "${fileName}" tidak sesuai dengan formatnya.`;
      throw new AppError(msg, 422, { attachments: msg });
    }
    out.push({ fileName, ext, mimeType: ALLOWED_FILE_TYPES[ext], bytes });
  }
  return out;
}

export type SubmitFeedbackResult = { id: string; ticketNumber: string; kind: FeedbackKind; title: string };

/**
 * Buat tiket Bantuan & Masukan dari formulir publik. Identitas pelapor: bila ADA sesi internal yang sah
 * (staf/manager/super_admin login), dipakai LANGSUNG dari sesi server — field reporterName/reporterContact
 * dari body TIDAK PERNAH dipercaya sebagai identitas (hanya dipakai bila benar-benar tamu/tanpa sesi).
 */
export async function submitFeedbackTicket(request: Request, form: FormData): Promise<SubmitFeedbackResult> {
  const session = await findSession(tokenFromRequest(request));

  const raw: Record<string, string> = {};
  for (const key of FORM_FIELDS) {
    const v = str(form.get(key));
    if (v !== "") raw[key] = v;
  }
  const parsed = feedbackSubmissionSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("Periksa kembali isian formulir.", 422, toFieldErrors(parsed.error));
  const input = parsed.data;

  let relatedOrderId: string | null = null;
  if (input.relatedOrderNumber) {
    // Request terkait harus BENAR-BENAR ada sebelum tautan disimpan (lihat findOrderForTracking — sumber
    // yang sama dipakai Riwayat Request publik, hanya mengembalikan field aman).
    const order = await findOrderForTracking(input.relatedOrderNumber);
    if (!order) throw new AppError("Nomor request yang Anda masukkan tidak ditemukan.", 422, { relatedOrderNumber: "Nomor request tidak ditemukan." });
    relatedOrderId = order.id;
  }

  const reporter: FeedbackReporter = session
    ? { userId: session.userId, name: session.name, contact: session.email }
    : { userId: null, name: input.reporterName ?? "Pemohon", contact: input.reporterContact };
  if (!session && !input.reporterName) throw new AppError("Nama pelapor wajib diisi.", 422, { reporterName: "Nama pelapor wajib diisi." });

  const prepared = await prepareAttachments(form.getAll("attachments"));

  let store: FileStorage | null = null;
  if (prepared.length > 0) {
    try {
      store = storage();
    } catch (error) {
      if (error instanceof StorageNotConfiguredError) throw new AppError("Penyimpanan lampiran belum dikonfigurasi. Kirim laporan tanpa lampiran, atau hubungi Super Admin.", 503);
      throw error;
    }
  }

  // Dibuat DI SINI (bukan default database) supaya path penyimpanan lampiran memakai ID tiket yang
  // SEBENARNYA — pola identik submitOrder (orderId dibuat dulu, lihat buildStoragePath).
  const ticketId = randomUUID();
  const attachments: NewFeedbackAttachment[] = [];
  if (store) {
    try {
      for (const f of prepared) {
        const path = `feedback/${ticketId}/${randomUUID()}.${f.ext}`;
        await store.put(path, f.bytes, f.mimeType);
        attachments.push({ fileName: f.fileName, storagePath: path, mimeType: f.mimeType, fileSize: f.bytes.byteLength });
      }
    } catch (error) {
      console.error("[submitFeedbackTicket] storage", error);
      await store.remove(attachments.map((a) => a.storagePath)).catch((e) => console.error("[submitFeedbackTicket] cleanup", e));
      throw new AppError("Lampiran gagal diunggah. Laporan belum tersimpan, silakan coba lagi.", 502);
    }
  }

  try {
    const created = await insertFeedbackTicket(
      ticketId,
      { kind: input.kind, title: input.title, relatedPage: input.relatedPage, detail: input.detail, impact: input.impact ?? null, relatedOrderId },
      reporter,
      attachments,
    );
    return { ...created, kind: input.kind, title: input.title };
  } catch (error) {
    // Jangan tinggalkan berkas yatim bila penyimpanan database gagal.
    if (store && attachments.length > 0) await store.remove(attachments.map((a) => a.storagePath)).catch((e) => console.error("[submitFeedbackTicket] cleanup", e));
    throw error;
  }
}
