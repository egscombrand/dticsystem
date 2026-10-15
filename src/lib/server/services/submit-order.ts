import "server-only";
import { randomUUID } from "node:crypto";
import { UPLOAD_LIMITS } from "@/lib/config/app";
import { ALLOWED_FILE_TYPES, checkFileBasics, contentMatchesExtension, formatFileSize, getExtension, sanitizeFileName } from "@/lib/files";
import { AppError, pgConstraint, pgErrorCode } from "@/lib/server/errors";
import { findOrderBySubmissionKey, insertOrder, type NewAttachment } from "@/lib/server/repositories/orders";
import { buildStoragePath, storage, StorageNotConfiguredError, type FileStorage } from "@/lib/server/storage";
import { str, toFieldErrors } from "@/lib/validation/common";
import { orderSubmissionSchema } from "@/lib/validation/order";

/** Field yang diterima dari form publik — field lain diabaikan (tidak ada mass assignment). */
const FORM_FIELDS = [
  "submissionKey",
  "requesterName",
  "requesterWhatsapp",
  "brandId",
  "department",
  "designTypeId",
  "designTypeOther",
  "sizePreset",
  "customWidth",
  "customHeight",
  "title",
  "briefDoc",
  "driveUrl",
  "deadline",
  "priority",
  "teamId",
] as const;

type PreparedFile = { fileName: string; ext: string; mimeType: string; bytes: Uint8Array };

async function prepareFiles(entries: FormDataEntryValue[]): Promise<PreparedFile[]> {
  const files = entries.filter((e): e is File => typeof e !== "string" && e.size > 0);
  if (files.length > UPLOAD_LIMITS.maxFiles)
    throw new AppError(`Maksimal ${UPLOAD_LIMITS.maxFiles} dokumen.`, 422, { attachments: `Maksimal ${UPLOAD_LIMITS.maxFiles} dokumen.` });
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > UPLOAD_LIMITS.maxTotalBytes) {
    const msg = `Total ukuran dokumen maksimal ${formatFileSize(UPLOAD_LIMITS.maxTotalBytes)}.`;
    throw new AppError(msg, 422, { attachments: msg });
  }
  const out: PreparedFile[] = [];
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

export type SubmitResult = {
  id: string;
  orderNumber: string;
  /** Timestamp pengajuan (dibuat server/database). */
  createdAt: string;
  deadlineAt: string;
  brandName: string;
  designType: string;
  duplicate: boolean;
  attachmentCount: number;
};

export async function submitOrder(form: FormData): Promise<SubmitResult> {
  const raw: Record<string, string | string[]> = {};
  for (const key of FORM_FIELDS) {
    const v = str(form.get(key));
    if (v !== "") raw[key] = v;
  }
  // PIC pilihan pemohon (boleh lebih dari satu). Field lain seperti picId/assigneeIds diabaikan.
  // Keanggotaan tim, status aktif, dan duplikasi divalidasi skema + server.
  const picIds = form.getAll("picIds").filter((v): v is string => typeof v === "string");
  if (picIds.length > 0) raw.picIds = picIds;
  const parsed = orderSubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("Periksa kembali isian formulir.", 422, toFieldErrors(parsed.error));
  }
  const input = parsed.data;

  // Pengiriman ganda (klik berulang / retry jaringan) → kembalikan order yang sama. Tidak membuat order baru.
  const existing = await findOrderBySubmissionKey(input.submissionKey);
  if (existing) return { ...existing, duplicate: true, attachmentCount: 0 };

  const files = await prepareFiles(form.getAll("attachments"));

  const orderId = randomUUID();
  let store: FileStorage | null = null;
  if (files.length > 0) {
    try {
      store = storage();
    } catch (error) {
      if (!(error instanceof StorageNotConfiguredError)) throw error;
      // Kesalahan konfigurasi server, bukan kesalahan pemohon. Belum ada data yang disimpan.
      console.error("[submitOrder] storage tidak terkonfigurasi:", error.message);
      throw new AppError(
        "Penyimpanan dokumen di server sedang bermasalah, jadi pengajuan belum tersimpan. Hubungi tim DTIC, atau kirim tanpa dokumen dan cantumkan tautan Google Drive.",
        503,
      );
    }
  }
  const uploaded: NewAttachment[] = [];
  const cleanup = async () => {
    if (store && uploaded.length > 0) {
      await store.remove(uploaded.map((u) => u.storagePath)).catch((e) => console.error("[submitOrder] cleanup", e));
    }
  };

  try {
    for (const f of files) {
      const storagePath = buildStoragePath(orderId, randomUUID(), f.ext);
      await store!.put(storagePath, f.bytes, f.mimeType);
      uploaded.push({ fileName: f.fileName, storagePath, mimeType: f.mimeType, fileSize: f.bytes.byteLength });
    }
  } catch (error) {
    console.error("[submitOrder] storage", error);
    await cleanup();
    throw new AppError("Dokumen gagal diunggah. Order belum tersimpan, silakan coba lagi.", 502);
  }

  try {
    const created = await insertOrder(orderId, input, uploaded);
    return { ...created, duplicate: false, attachmentCount: uploaded.length };
  } catch (error) {
    // Jangan tinggalkan berkas yatim bila penyimpanan database gagal.
    await cleanup();
    if (pgErrorCode(error) === "23505" && pgConstraint(error) === "orders_submission_key_key") {
      const again = await findOrderBySubmissionKey(input.submissionKey);
      if (again) return { ...again, duplicate: true, attachmentCount: 0 };
    }
    if (pgErrorCode(error) === "23503") {
      throw new AppError("Brand tidak ditemukan.", 422, { brandId: "Brand tidak ditemukan. Pilih brand lain." });
    }
    throw error;
  }
}
