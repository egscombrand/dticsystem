import "server-only";
import { randomUUID } from "node:crypto";
import { COLLAB_LIMITS, messageProblem, normalizeMessageBody, type ActivityItem, type BriefChange, type BriefVersion, type ChatMessage, type ChatPage, type OrderBadges, type ReferenceFile, type SenderKind } from "@/lib/collab";
import { ALLOWED_FILE_TYPES, checkFileBasics, contentMatchesExtension, getExtension, sanitizeFileName } from "@/lib/files";
import { parseRichDoc } from "@/lib/rich-text";
import { isFinishedStatus, type OrderStatus } from "@/lib/status";
import type { Session } from "@/lib/server/auth";
import { AppError, NotFoundError } from "@/lib/server/errors";
import { UUID_RE } from "@/lib/server/http";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { findOrderForTracking, listPicNames } from "@/lib/server/repositories/orders";
import * as repo from "@/lib/server/repositories/collab";
import { normalizeOrderNumber, ORDER_NUMBER_RE } from "@/lib/server/services/tracking";
import { buildStoragePath, storage, StorageNotConfiguredError } from "@/lib/server/storage";

const WINDOW_MS = 15 * 60_000;
/** Polling ~4 dtk per tab terbuka ≈ 225 permintaan / 15 menit; batas dibuat longgar karena satu IP bisa dipakai banyak orang. */
const POLL_LIMIT = 1500;
const READ_LIMIT = 400;
const WRITE_LIMIT = 90;

type Body = Record<string, unknown>;

function limitOrThrow(key: string, max: number) {
  const r = rateLimit(key, max, WINDOW_MS);
  if (!r.ok) throw new AppError(`Terlalu banyak permintaan. Coba lagi dalam ${Math.max(1, Math.ceil(r.retryAfterSeconds / 60))} menit.`, 429);
}

// ---------------------------------------------------------------- berkas (dipakai chat & referensi)

type Prepared = { fileName: string; ext: string; mimeType: string; bytes: Uint8Array };

async function prepareFiles(entries: FormDataEntryValue[], maxFiles: number, maxBytes: number, maxBytesLabel: string): Promise<Prepared[]> {
  const files = entries.filter((e): e is File => typeof e !== "string" && e.size > 0);
  if (files.length > maxFiles) throw new AppError(`Maksimal ${maxFiles} berkas per kiriman.`, 422, { attachments: `Maksimal ${maxFiles} berkas per kiriman.` });
  if (files.reduce((s, f) => s + f.size, 0) > maxBytes) {
    const msg = `Total ukuran berkas per kiriman maksimal ${maxBytesLabel}.`;
    throw new AppError(msg, 422, { attachments: msg });
  }
  const out: Prepared[] = [];
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

/** Simpan berkas ke penyimpanan lalu jalankan `persist`; bila database gagal, berkas yatim dibersihkan. */
async function storeAndPersist<T>(orderId: string, files: Prepared[], persist: (stored: repo.NewMessageAttachment[]) => Promise<T>): Promise<T> {
  if (files.length === 0) return persist([]);
  let store;
  try {
    store = storage();
  } catch (error) {
    if (!(error instanceof StorageNotConfiguredError)) throw error;
    console.error("[collab] storage tidak terkonfigurasi:", error.message);
    throw new AppError("Penyimpanan berkas di server sedang bermasalah. Kirim tanpa lampiran atau hubungi tim DTIC.", 503);
  }
  const stored: repo.NewMessageAttachment[] = [];
  const cleanup = async () => {
    if (stored.length > 0) await store.remove(stored.map((s) => s.storagePath)).catch((e) => console.error("[collab] cleanup", e));
  };
  try {
    for (const f of files) {
      const storagePath = buildStoragePath(orderId, randomUUID(), f.ext);
      await store.put(storagePath, f.bytes, f.mimeType);
      stored.push({ fileName: f.fileName, storagePath, mimeType: f.mimeType, fileSize: f.bytes.byteLength });
    }
  } catch (error) {
    console.error("[collab] storage", error);
    await cleanup();
    throw new AppError("Berkas gagal diunggah. Silakan coba lagi.", 502);
  }
  try {
    return await persist(stored);
  } catch (error) {
    await cleanup();
    throw error;
  }
}

// ---------------------------------------------------------------- pembaca/pengirim

type Party = {
  orderId: string;
  status: OrderStatus;
  reader: repo.Reader;
  viewer: SenderKind;
  sender: repo.MessageSender;
};

function internalKind(session: Session): SenderKind {
  return session.role === "super_admin" ? "super_admin" : session.role === "manager" ? "manager" : "staff";
}

async function publicParty(request: Request, rawOrderNumber: unknown, kind: "poll" | "read" | "write"): Promise<Party & { orderNumber: string; requesterName: string }> {
  const orderNumber = normalizeOrderNumber(typeof rawOrderNumber === "string" ? rawOrderNumber : "");
  if (!ORDER_NUMBER_RE.test(orderNumber)) throw new AppError("Format nomor order tidak valid, contoh: DTIC-2026-00012.", 422);
  limitOrThrow(`collab-${kind}-ip:${clientIp(request)}`, kind === "poll" ? POLL_LIMIT : kind === "read" ? READ_LIMIT : WRITE_LIMIT);
  const order = await findOrderForTracking(orderNumber);
  if (!order) throw new NotFoundError("Nomor order tidak ditemukan. Periksa kembali nomor yang Anda terima saat pengajuan.");
  const requesterName = `${order.requester_name} (Pemohon)`.slice(0, 160);
  return {
    orderId: order.id,
    orderNumber,
    status: order.status,
    requesterName,
    reader: repo.REQUESTER_READER,
    viewer: "requester",
    sender: { kind: "requester", name: requesterName, userId: null },
  };
}

function internalParty(session: Session, orderId: string, status: Party["status"]): Party {
  const kind = internalKind(session);
  return { orderId, status, reader: { kind: kind as repo.Reader["kind"], key: session.userId }, viewer: kind, sender: { kind, name: session.name.slice(0, 160), userId: session.userId } };
}

// ---------------------------------------------------------------- chat (inti, dipakai publik & internal)

async function chatPage(p: Party, afterSeq: number): Promise<ChatPage> {
  const [messages, lastSeq, read, picNames] = await Promise.all([
    repo.listMessages(p.orderId, afterSeq),
    repo.getLastSeq(p.orderId),
    repo.getReadState(p.orderId, p.reader),
    listPicNames(p.orderId),
  ]);
  const unread = await repo.countUnread(p.orderId, p.viewer, read.lastReadSeq);
  return { messages, lastSeq, lastReadSeq: read.lastReadSeq, unread, picNames, closed: isFinishedStatus(p.status) };
}

function parseAfter(raw: unknown): number {
  const n = typeof raw === "string" || typeof raw === "number" ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function chatSend(p: Party, form: FormData): Promise<{ message: ChatMessage; duplicate: boolean }> {
  if (isFinishedStatus(p.status)) throw new AppError("Pekerjaan ini sudah selesai atau dibatalkan, sehingga diskusi ditutup.", 409);
  const body = normalizeMessageBody(form.get("body"));
  const rawKey = form.get("requestKey");
  const requestKey = typeof rawKey === "string" && UUID_RE.test(rawKey) ? rawKey : null;
  const entries = form.getAll("attachments");
  const sizes = entries.filter((e): e is File => typeof e !== "string" && e.size > 0).map((f) => ({ size: f.size }));
  const problem = messageProblem(body, sizes);
  if (problem) throw new AppError(problem.message, 422, { [problem.field]: problem.message });
  if (requestKey) {
    const dup = await repo.findMessageByRequestKey(p.orderId, requestKey);
    if (dup) return { message: dup, duplicate: true };
  }
  if (sizes.length > 0 && (await repo.countMessageAttachments(p.orderId)) + sizes.length > COLLAB_LIMITS.chatMaxAttachmentsPerOrder)
    throw new AppError(`Batas lampiran diskusi untuk order ini tercapai (${COLLAB_LIMITS.chatMaxAttachmentsPerOrder} berkas).`, 422, { attachments: "Batas lampiran tercapai." });
  const files = await prepareFiles(entries, COLLAB_LIMITS.chatMaxFiles, COLLAB_LIMITS.chatMaxBytesPerMessage, "4 MB");
  return storeAndPersist(p.orderId, files, (attachments) => repo.insertMessage({ orderId: p.orderId, sender: p.sender, body, requestKey, attachments }));
}

async function markReadBody(p: Party, body: Body) {
  const upTo = parseAfter(body.upToSeq);
  const lastReadSeq = await repo.markRead(p.orderId, p.reader, upTo);
  return { lastReadSeq };
}

// ---------------------------------------------------------------- Pemohon (publik)

export async function publicChatRead(request: Request, orderNumber: string, after: string | null): Promise<ChatPage> {
  const p = await publicParty(request, orderNumber, "poll");
  return chatPage(p, parseAfter(after));
}

export async function publicChatSend(request: Request, form: FormData) {
  const p = await publicParty(request, form.get("order"), "write");
  return chatSend(p, form);
}

export async function publicCollabAction(request: Request, body: Body) {
  const p = await publicParty(request, body.order, "write");
  switch (body.action) {
    case "read":
      return markReadBody(p, body);
    case "results_seen":
      await repo.markResultsSeen(p.orderId, p.reader);
      return { ok: true };
    case "brief_change": {
      const parsed = parseRichDoc(body.briefDoc);
      if (!parsed.ok) throw new AppError(parsed.error, 422, { briefDoc: parsed.error });
      if (parsed.text.replace(/\s+/g, " ").trim().length < 10) throw new AppError("Brief minimal 10 karakter.", 422, { briefDoc: "Brief minimal 10 karakter." });
      const reason = typeof body.reason === "string" ? body.reason : "";
      const requestKey = typeof body.requestKey === "string" && UUID_RE.test(body.requestKey) ? body.requestKey : null;
      return repo.createBriefChange({ orderId: p.orderId, proposed: { doc: parsed.doc, text: parsed.text }, reason, requestedByName: p.requesterName, requestKey });
    }
    case "brief_withdraw": {
      const id = typeof body.changeId === "string" && UUID_RE.test(body.changeId) ? body.changeId : null;
      if (!id) throw new AppError("Usulan tidak valid.", 422);
      await repo.withdrawBriefChange(p.orderId, id, p.requesterName);
      return { ok: true };
    }
    default:
      throw new AppError("Aksi tidak dikenal.", 400);
  }
}

export type CollabSection = {
  brief: Awaited<ReturnType<typeof repo.getBriefSummary>>;
  versions: BriefVersion[];
  changes: BriefChange[];
  references: ReferenceFile[];
  activity: ActivityItem[];
};

export async function publicCollabRead(request: Request, orderNumber: string): Promise<CollabSection> {
  const p = await publicParty(request, orderNumber, "read");
  const [brief, versions, changes, references, activity] = await Promise.all([
    repo.getBriefSummary(p.orderId),
    repo.listBriefVersions(p.orderId),
    repo.listBriefChanges(p.orderId),
    repo.listReferences(p.orderId),
    repo.getRequesterActivity(p.orderId),
  ]);
  return { brief, versions, changes, references, activity };
}

export async function publicReferenceUpload(request: Request, form: FormData): Promise<{ references: ReferenceFile[] }> {
  const p = await publicParty(request, form.get("order"), "write");
  if (isFinishedStatus(p.status)) throw new AppError("Pekerjaan ini sudah selesai atau dibatalkan; berkas referensi tidak dapat ditambahkan.", 409);
  const entries = form.getAll("attachments");
  const count = entries.filter((e): e is File => typeof e !== "string" && e.size > 0).length;
  if (count === 0) throw new AppError("Pilih berkas yang ingin ditambahkan.", 422, { attachments: "Pilih berkas yang ingin ditambahkan." });
  if ((await repo.countLateReferences(p.orderId)) + count > COLLAB_LIMITS.referenceMaxLatePerOrder)
    throw new AppError(`Batas tambahan berkas referensi untuk order ini tercapai (${COLLAB_LIMITS.referenceMaxLatePerOrder} berkas).`, 422, { attachments: "Batas tercapai." });
  const files = await prepareFiles(entries, COLLAB_LIMITS.referenceMaxFiles, COLLAB_LIMITS.referenceMaxBytesPerUpload, "4 MB");
  await storeAndPersist(p.orderId, files, (stored) => repo.insertLateReferences(p.orderId, stored, p.requesterName));
  return { references: await repo.listReferences(p.orderId) };
}

export async function publicBadges(request: Request, rawNumbers: string | null): Promise<{ badges: OrderBadges[] }> {
  limitOrThrow(`collab-badges-ip:${clientIp(request)}`, 400);
  const numbers = [...new Set((rawNumbers ?? "").split(",").map(normalizeOrderNumber).filter((n) => ORDER_NUMBER_RE.test(n)))];
  if (numbers.length > COLLAB_LIMITS.badgeBatchMax) throw new AppError(`Maksimal ${COLLAB_LIMITS.badgeBatchMax} nomor order sekali cek.`, 422);
  return { badges: await repo.getBadges(numbers) };
}

/** Berkas yang boleh diunduh Pemohon lewat jalur kolaborasi: lampiran chat order itu & berkas referensi order itu. */
export async function publicCollabFile(request: Request, orderNumber: string | null, id: string, kind: string | null) {
  const p = await publicParty(request, orderNumber, "read");
  return resolveFile(p.orderId, id, kind);
}

async function resolveFile(orderId: string, id: string, kind: string | null) {
  if (!UUID_RE.test(id)) throw new NotFoundError("Berkas tidak ditemukan.");
  if (kind === "reference") {
    const f = await repo.getReferenceFile(orderId, id);
    if (!f?.storage_path) throw new NotFoundError("Berkas tidak ditemukan.");
    return { fileName: f.file_name, mimeType: f.mime_type, fileSize: Number(f.file_size), body: await storage().get(f.storage_path) };
  }
  const f = await repo.getMessageAttachment(id);
  if (!f || f.order_id !== orderId) throw new NotFoundError("Berkas tidak ditemukan.");
  return { fileName: f.file_name, mimeType: f.mime_type, fileSize: Number(f.file_size), body: await storage().get(f.storage_path) };
}

// ---------------------------------------------------------------- PIC / Manager / Super Admin (internal)

async function internalOrder(session: Session, orderId: string) {
  const brief = await repo.getBriefSummary(orderId);
  return internalParty(session, orderId, brief.status);
}

export async function internalChatRead(session: Session, orderId: string, after: string | null): Promise<ChatPage> {
  return chatPage(await internalOrder(session, orderId), parseAfter(after));
}

export async function internalChatSend(session: Session, orderId: string, form: FormData) {
  const p = await internalOrder(session, orderId);
  return chatSend(p, form);
}

export async function internalCollabAction(session: Session, orderId: string, body: Body) {
  const p = await internalOrder(session, orderId);
  switch (body.action) {
    case "read":
      return markReadBody(p, body);
    case "brief_accept":
    case "brief_reject": {
      const changeId = typeof body.changeId === "string" && UUID_RE.test(body.changeId) ? body.changeId : null;
      if (!changeId) throw new AppError("Usulan tidak valid.", 422);
      const note = typeof body.note === "string" ? body.note.slice(0, 1000) : null;
      return repo.decideBriefChange({ orderId, changeId, decision: body.action === "brief_accept" ? "accept" : "reject", note, actor: { name: session.name, userId: session.userId } });
    }
    default:
      throw new AppError("Aksi tidak dikenal.", 400);
  }
}

export async function internalCollabRead(_session: Session, orderId: string) {
  const [brief, versions, changes, references] = await Promise.all([
    repo.getBriefSummary(orderId),
    repo.listBriefVersions(orderId),
    repo.listBriefChanges(orderId),
    repo.listReferences(orderId),
  ]);
  return { brief, versions, changes, references };
}

export async function internalCollabFile(orderId: string, id: string, kind: string | null) {
  return resolveFile(orderId, id, kind);
}
