import { normalizeIdWhatsapp } from "@/lib/whatsapp";
import { z } from "zod";
import { CUSTOM_SIZE_MAX_CM, DESIGN_SIZE_PRESETS } from "@/lib/config/order-options";
import { dateOnlyDeadlineToUtc, toDateKey, zonedLocalToUtc } from "@/lib/dates";
import { parseRichDoc } from "@/lib/rich-text";
import { ORDER_STATUSES } from "@/lib/status";

const requiredText = (label: string, min: number, max: number) =>
  z
    .string({ error: `${label} wajib diisi.` })
    .trim()
    .min(1, `${label} wajib diisi.`)
    .min(min, `${label} minimal ${min} karakter.`)
    .max(max, `${label} maksimal ${max} karakter.`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} maksimal ${max} karakter.`)
    .optional()
    .transform((v) => (v ? v : null));

const optionalYear = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!/^\d{4}$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "Tahun harus 4 digit, misalnya 2026." });
      return z.NEVER;
    }
    const n = Number(v);
    if (n < 1900 || n > 2100) {
      ctx.addIssue({ code: "custom", message: "Tahun harus di antara 1900 dan 2100." });
      return z.NEVER;
    }
    return n;
  });

const deadlineField = z
  .string({ error: "Deadline wajib diisi." })
  .trim()
  .min(1, "Deadline wajib diisi.")
  .transform((v, ctx) => {
    const d = zonedLocalToUtc(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Format deadline tidak valid." });
      return z.NEVER;
    }
    return d;
  });

/** Deadline dari input tanggal (form publik) → 23.59 WIB pada tanggal itu. */
const deadlineDateField = z
  .string({ error: "Deadline wajib diisi." })
  .trim()
  .min(1, "Deadline wajib diisi.")
  .transform((v, ctx) => {
    const d = dateOnlyDeadlineToUtc(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Format tanggal deadline tidak valid." });
      return z.NEVER;
    }
    return d;
  });

/** Jam deadline (HH:mm, WIB). Opsional pada form publik: kosong = akhir hari (23.59 WIB). */
const DEADLINE_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const deadlineTimeField = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || DEADLINE_TIME_RE.test(v), { message: "Format jam deadline tidak valid (HH:mm)." });

/** Deadline final: tanggal (WIB) + jam bila diisi; tanpa jam = 23.59 WIB pada tanggal itu. */
function combineDeadline(date: Date, time?: string): Date | null {
  if (!time) return date;
  return zonedLocalToUtc(`${toDateKey(date)}T${time}`);
}

const brandIdField = z.uuid({ error: "Pilih brand pemohon." });
/** Jenis order & prioritas berupa identifier; keberadaan & status aktifnya dicek ke database di server. */
const designTypeIdField = z.uuid({ error: "Pilih jenis order desain." });
const designTypeOtherField = optionalText("Jenis desain lainnya", 60);
const priorityCodeField = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,29}$/, "Pilih prioritas.");

/** Brief rich text: string JSON (FormData) atau objek (JSON API) → dokumen tersanitasi + teks polos. */
const briefDocField = z.unknown().transform((v, ctx) => {
  if (v === undefined || v === null || v === "") {
    ctx.addIssue({ code: "custom", message: "Deskripsi desain wajib diisi." });
    return z.NEVER;
  }
  const parsed = parseRichDoc(v);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.error });
    return z.NEVER;
  }
  if (parsed.text.replace(/\s+/g, " ").trim().length < 10) {
    ctx.addIssue({ code: "custom", message: "Deskripsi desain minimal 10 karakter." });
    return z.NEVER;
  }
  return { doc: parsed.doc, text: parsed.text };
});

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

/** URL Google Drive (opsional). Hanya https ke drive/docs.google.com; disimpan sebagai tautan, tidak diakses server. */
export const driveUrlField = z
  .string()
  .trim()
  .max(2000, "URL terlalu panjang.")
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "URL tidak valid. Salin tautan lengkap dari Google Drive (https://drive.google.com/…)." });
      return z.NEVER;
    }
    if (u.protocol !== "https:" || !DRIVE_HOSTS.has(u.hostname) || u.username || u.password) {
      ctx.addIssue({ code: "custom", message: "Gunakan tautan Google Drive/Docs (https://drive.google.com/… atau https://docs.google.com/…)." });
      return z.NEVER;
    }
    return u.toString();
  });

const sizePresetValues = DESIGN_SIZE_PRESETS.map((p) => p.value) as [string, ...string[]];

const cmField = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0 || n > CUSTOM_SIZE_MAX_CM) {
        ctx.addIssue({ code: "custom", message: `${label} harus angka 0,1–${CUSTOM_SIZE_MAX_CM} cm.` });
        return z.NEVER;
      }
      return Math.round(n * 10) / 10;
    });

const fmtCm = (n: number) => String(n).replace(".", ",");

/** Daftar PIC: id member unik (urutan tidak penting). Kosong = belum ditugaskan. */
const assigneeIdsField = z
  .array(z.uuid({ error: "Member tidak valid." }), { error: "Daftar PIC tidak valid." })
  .max(20, "Maksimal 20 PIC per order.")
  .transform((ids) => [...new Set(ids)]);

/** PIC pilihan pemohon (form publik): minimal satu, tanpa duplikat. Keanggotaan tim divalidasi server. */
const picIdsField = z
  .array(z.uuid({ error: "PIC tidak valid." }), { error: "Pilih minimal satu anggota tim." })
  .min(1, "Pilih minimal satu anggota tim.")
  .max(10, "Terlalu banyak PIC dipilih.")
  .refine((ids) => new Set(ids).size === ids.length, { message: "Anggota yang sama tidak boleh dipilih dua kali." });

/**
 * Skema form pengajuan publik — mengikuti kolom spreadsheet lama:
 * Nama, Perusahaan (brand), Departemen/Divisi, Jenis Order Desain, Ukuran,
 * Deskripsi Desain, Dokumen pendukung (file), Deadline (tanggal).
 * Timestamp & nomor order dibuat server; Close = status yang dikelola tim DTIC.
 * Hanya field di sini yang diterima (mencegah mass assignment).
 */
/** Nomor WhatsApp pemohon: divalidasi & dinormalisasi ke "628…" (lihat src/lib/whatsapp.ts). */
const whatsappField = z
  .string({ error: "Nomor WhatsApp wajib diisi." })
  .transform((v, ctx) => {
    const r = normalizeIdWhatsapp(v);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.message });
      return z.NEVER;
    }
    return r.value;
  });

export const orderSubmissionSchema = z
  .object({
    submissionKey: z.uuid({ error: "Sesi formulir tidak valid. Muat ulang halaman." }),
    requesterName: requiredText("Nama", 2, 120),
    /** Judul pekerjaan: field tersendiri (bukan turunan deskripsi). */
    title: requiredText("Judul pekerjaan", 3, 160),
    brandId: brandIdField,
    department: requiredText("Departemen/divisi", 2, 120),
    requesterWhatsapp: whatsappField,
    designTypeId: designTypeIdField,
    designTypeOther: designTypeOtherField,
    sizePreset: z.enum(sizePresetValues, { error: "Pilih ukuran desain." }),
    customWidth: cmField("Lebar"),
    customHeight: cmField("Tinggi"),
    briefDoc: briefDocField,
    driveUrl: driveUrlField,
    deadline: deadlineDateField,
    deadlineTime: deadlineTimeField,
    priority: priorityCodeField.optional(),
    /** Kategori pekerjaan = tim penanggung jawab. */
    teamId: z.uuid({ error: "Pilih kategori pekerjaan." }),
    /** Anggota tim yang dipilih pemohon (satu atau lebih); server memastikan semuanya anggota aktif tim kategori. */
    picIds: picIdsField,
  })
  .superRefine((v, ctx) => {
    if (v.sizePreset === "custom") {
      if (v.customWidth == null) ctx.addIssue({ code: "custom", path: ["customWidth"], message: "Isi lebar dalam cm." });
      if (v.customHeight == null) ctx.addIssue({ code: "custom", path: ["customHeight"], message: "Isi tinggi dalam cm." });
    }
    // Tanggal deadline paling cepat hari ini (WIB).
    if (toDateKey(v.deadline) < toDateKey(new Date())) {
      ctx.addIssue({ code: "custom", path: ["deadline"], message: "Tanggal deadline tidak boleh sebelum hari ini." });
    } else if (v.deadlineTime) {
      const at = combineDeadline(v.deadline, v.deadlineTime);
      if (!at) ctx.addIssue({ code: "custom", path: ["deadlineTime"], message: "Jam deadline tidak valid." });
      else if (at.getTime() < Date.now()) ctx.addIssue({ code: "custom", path: ["deadlineTime"], message: "Waktu deadline sudah lewat." });
    }
  })
  .transform((v) => ({
    submissionKey: v.submissionKey,
    requesterName: v.requesterName,
    requesterWhatsapp: v.requesterWhatsapp,
    department: v.department,
    brandId: v.brandId,
    designTypeId: v.designTypeId,
    designTypeOther: v.designTypeOther,
    designSize:
      v.sizePreset === "custom"
        ? `Custom ${fmtCm(v.customWidth!)} × ${fmtCm(v.customHeight!)} cm`
        : (DESIGN_SIZE_PRESETS.find((p) => p.value === v.sizePreset)?.label ?? v.sizePreset),
    brief: v.briefDoc.text,
    briefRich: v.briefDoc.doc,
    driveUrl: v.driveUrl,
    deadlineAt: combineDeadline(v.deadline, v.deadlineTime) ?? v.deadline,
    /** null → default prioritas dari konfigurasi server. */
    priority: v.priority ?? null,
    title: v.title,
    teamId: v.teamId,
    picIds: v.picIds,
  }));

export type OrderSubmissionInput = z.output<typeof orderSubmissionSchema>;

/** Skema edit detail order oleh DTIC (internal). Nomor order, status, tanggal masuk tidak bisa diubah di sini. */
/** Alur baru tidak punya tahap tanpa PIC: koreksi penugasan oleh Super Admin minimal satu member. */
const assigneeIdsRequired = assigneeIdsField.refine((ids) => ids.length > 0, { message: "Pilih minimal satu PIC." });

/** Alasan perubahan PIC: wajib, tersimpan di audit log. */
const assigneeReasonField = requiredText("Alasan perubahan PIC", 5, 300);

/**
 * Perubahan PIC oleh Manager/Super Admin. expectedMemberIds = PIC yang dilihat pengguna saat membuka
 * panel; bila sudah berubah di server, perubahan ditolak (konflik edit) agar tidak menimpa pekerjaan orang lain.
 */
export const assigneesSchema = z
  .object({
    memberIds: assigneeIdsRequired,
    reason: assigneeReasonField,
    expectedMemberIds: z.array(z.uuid({ error: "PIC tidak valid." })).max(20).optional(),
  })
  .strict();

export const orderUpdateSchema = z
  .object({
    requesterName: requiredText("Nama", 2, 120),
    company: optionalText("Keterangan perusahaan", 120),
    department: requiredText("Departemen/divisi", 2, 120),
    /** Opsional saat edit: pengajuan lama boleh belum punya nomor. Kosong = tidak diubah. */
    requesterWhatsapp: z.union([z.literal(""), whatsappField]).optional(),
    brandId: brandIdField,
    designTypeId: designTypeIdField,
    designTypeOther: designTypeOtherField,
    designSize: requiredText("Ukuran desain", 1, 120),
    title: requiredText("Judul desain", 3, 160),
    briefDoc: briefDocField,
    driveUrl: driveUrlField,
    briefYear: optionalYear,
    briefReference: optionalText("Referensi", 2000),
    designRequirements: optionalText("Kebutuhan desain", 3000),
    deadline: deadlineField,
    priority: priorityCodeField,
    assigneeIds: assigneeIdsRequired.optional(),
    /** Wajib bila daftar PIC berubah lewat form edit. */
    assigneeReason: optionalText("Alasan perubahan PIC", 300),
  })
  .strict()
  .transform(({ deadline, briefDoc, ...rest }) => ({ ...rest, brief: briefDoc.text, briefRich: briefDoc.doc, deadlineAt: deadline }));

export type OrderUpdateInput = z.output<typeof orderUpdateSchema>;

export const statusChangeSchema = z
  .object({
    status: z.enum(ORDER_STATUSES, { error: "Status tidak valid." }),
    note: optionalText("Catatan", 1000),
    /** true = catatan ini boleh ditampilkan ke pemohon di halaman pelacakan. */
    noteForClient: z.boolean().optional(),
  })
  .strict();

export const internalNotesSchema = z
  .object({
    internalNotes: z.string().max(10000, "Catatan internal maksimal 10.000 karakter.").transform((v) => (v.trim() ? v : null)),
  })
  .strict();

/** Perubahan deadline oleh Manager/Super Admin: tanggal + jam WIB (tanpa jam = 23.59) dan alasan wajib. */
export const deadlineChangeSchema = z
  .object({
    deadlineDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal deadline tidak valid."),
    deadlineTime: deadlineTimeField,
    reason: requiredText("Alasan perubahan deadline", 5, 300),
  })
  .strict()
  .transform((v, ctx) => {
    const at = zonedLocalToUtc(`${v.deadlineDate}T${v.deadlineTime ?? "23:59"}`);
    if (!at) {
      ctx.addIssue({ code: "custom", path: ["deadlineDate"], message: "Tanggal deadline tidak valid." });
      return z.NEVER;
    }
    return { deadlineAt: at, reason: v.reason };
  });
export type DeadlineChangeInput = z.output<typeof deadlineChangeSchema>;
