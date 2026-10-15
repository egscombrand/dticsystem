import type { HistoryStatus, OrderStatus } from "@/lib/status";

export type Brand = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type BrandOption = Pick<Brand, "id" | "name" | "isActive">;

/** Opsi data master dari database (dipakai form & filter). */
export type OrderTypeOption = { id: string; name: string; requiresDetail: boolean; isActive: boolean; teamId: string | null };
/** Tim penanggung jawab (kategori pekerjaan) beserta anggota aktifnya — untuk form publik. */
export type TeamOption = { id: string; slug: string; name: string; description: string; members: { id: string; name: string }[] };
export type PriorityOption = { code: string; name: string; tone: string; isActive: boolean };
export type DepartmentOption = { id: string; name: string; isActive: boolean };

/** Member DTIC yang ditugaskan (PIC) pada order. `division` contoh: "Staff of Creative". */
export type Assignee = { id: string; name: string; division: string; isActive: boolean };
/** Pilihan member untuk penugasan (dari tabel dtic_members). */
export type MemberOption = Assignee & { departmentName: string };

export type OrderListItem = {
  id: string;
  orderNumber: string;
  requesterName: string;
  /** Keterangan perusahaan teks bebas (data lama/internal). Identitas pemohon utama = brand pemohon (brand_id). */
  company: string | null;
  department: string;
  title: string;
  designType: string;
  brandId: string;
  brandName: string;
  deadlineAt: string;
  /** Kode level prioritas (priority_levels.code). */
  priority: string;
  priorityName: string;
  /** Warna badge dari database (StatusTone). */
  priorityTone: string;
  status: OrderStatus;
  createdAt: string;
  /** Kategori pekerjaan (tim); null untuk order lama tanpa tim. */
  teamId: string | null;
  teamName: string | null;
  /** PIC / member DTIC yang ditugaskan; kosong = belum ditugaskan. */
  assignees: Assignee[];
};

export type OrderAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
};

export type StatusHistoryEntry = {
  id: string;
  /** Bisa berisi kode status lama (riwayat sebelum alur baru). */
  previousStatus: HistoryStatus | null;
  newStatus: HistoryStatus;
  changedAt: string;
  notes: string | null;
  /** Nama pelaku perubahan. */
  actor: string;
};

export type OrderDetail = OrderListItem & {
  requesterWhatsapp: string | null;
  /** Kategori/tim order; null untuk order lama tanpa tim. */
  teamId: string | null;
  designSize: string;
  brief: string;
  briefYear: number | null;
  briefReference: string | null;
  designRequirements: string | null;
  internalNotes: string | null;
  updatedAt: string;
  completedAt: string | null;
  brandIsActive: boolean;
  designOrderTypeId: string | null;
  /** Dokumen rich text (JSON tersanitasi); null untuk data lama. */
  briefRich: unknown;
  driveUrl: string | null;
  /** Pesan / permintaan informasi yang ditampilkan ke pemohon di halaman Riwayat Request. */
  requesterMessage: string | null;
  /** Tautan hasil akhir yang boleh dilihat pemohon. */
  resultUrl: string | null;
  hasTrackingCode: boolean;
  attachments: OrderAttachment[];
  history: StatusHistoryEntry[];
};
