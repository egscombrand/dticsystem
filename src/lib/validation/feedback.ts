import { z } from "zod";

export const FEEDBACK_KINDS = ["bug", "suggestion", "feature_request", "question"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  bug: "Bug / Kendala",
  suggestion: "Saran Perbaikan",
  feature_request: "Permintaan Fitur",
  question: "Pertanyaan / Bantuan",
};

export const FEEDBACK_IMPACTS = ["low", "normal", "high"] as const;
export type FeedbackImpact = (typeof FEEDBACK_IMPACTS)[number];
export const FEEDBACK_IMPACT_LABEL: Record<FeedbackImpact, string> = {
  low: "Rendah — gangguan kecil, pekerjaan masih dapat dilanjutkan.",
  normal: "Normal — sebagian fungsi terganggu.",
  high: "Tinggi — pekerjaan penting terhambat.",
};

export const FEEDBACK_PAGES = ["home", "submit", "history", "detail", "qc", "result_files", "other"] as const;
export type FeedbackPage = (typeof FEEDBACK_PAGES)[number];
export const FEEDBACK_PAGE_LABEL: Record<FeedbackPage, string> = {
  home: "Beranda",
  submit: "Ajukan Request",
  history: "Riwayat Request",
  detail: "Detail Pekerjaan",
  qc: "Pemeriksaan QC",
  result_files: "File Hasil",
  other: "Lainnya",
};

export const FEEDBACK_STATUSES = ["new", "reviewed", "in_progress", "need_info", "done", "wont_fix"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "Baru",
  reviewed: "Ditinjau",
  in_progress: "Sedang Ditangani",
  need_info: "Menunggu Informasi",
  done: "Selesai",
  wont_fix: "Tidak Ditindaklanjuti",
};

export const FEEDBACK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];
export const FEEDBACK_PRIORITY_LABEL: Record<FeedbackPriority, string> = {
  low: "Rendah",
  normal: "Normal",
  high: "Tinggi",
  urgent: "Mendesak",
};

const requiredText = (label: string, min: number, max: number) =>
  z
    .string({ error: `${label} wajib diisi.` })
    .trim()
    .min(1, `${label} wajib diisi.`)
    .min(min, `${label} minimal ${min} karakter.`)
    .max(max, `${label} maksimal ${max} karakter.`);

/** Formulir publik Bantuan & Masukan — reporterName/reporterContact HANYA dipakai bila tidak ada sesi
 *  internal (lihat submitFeedbackTicket: identitas pengguna login diambil dari sesi, bukan field ini). */
export const feedbackSubmissionSchema = z
  .object({
    kind: z.enum(FEEDBACK_KINDS, { error: "Pilih jenis laporan." }),
    title: requiredText("Judul laporan", 3, 160),
    relatedPage: z.enum(FEEDBACK_PAGES, { error: "Pilih halaman atau fitur terkait." }),
    detail: requiredText("Detail laporan", 10, 5000),
    impact: z.enum(FEEDBACK_IMPACTS).optional(),
    relatedOrderNumber: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v.toUpperCase().replace(/\s+/g, "") : null)),
    reporterName: z
      .string()
      .trim()
      .max(120, "Nama maksimal 120 karakter.")
      .optional()
      .transform((v) => (v ? v : null)),
    reporterContact: z
      .string()
      .trim()
      .max(160, "Kontak maksimal 160 karakter.")
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "bug" && !v.impact) {
      ctx.addIssue({ code: "custom", message: "Tingkat dampak wajib diisi untuk Bug/Kendala.", path: ["impact"] });
    }
  });
export type FeedbackSubmissionInput = z.output<typeof feedbackSubmissionSchema>;

export const feedbackStatusUpdateSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES, { error: "Status tidak valid." }),
  message: z.string().trim().max(3000).optional(),
  closeReason: z.string().trim().max(1000).optional(),
  resolutionSummary: z.string().trim().max(3000).optional(),
});

export const feedbackPrioritySchema = z.object({ priority: z.enum(FEEDBACK_PRIORITIES).nullable() });
export const feedbackAssigneeSchema = z.object({ assigneeUserId: z.uuid().nullable() });
export const feedbackNoteSchema = z.object({ message: requiredText("Catatan", 1, 3000) });
export const feedbackReplySchema = z.object({ ticketNumber: z.string().trim().min(1), message: requiredText("Jawaban", 1, 3000) });

/** Aktif/nonaktif grup Telegram Tim IT (satu grup global, tanpa jenis notifikasi per event). */
export const feedbackTelegramActiveSchema = z.object({ isActive: z.boolean() }).strict();
