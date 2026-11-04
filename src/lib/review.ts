/**
 * Review Center (MURNI: dipakai server, UI, dan unit test). Tiga dimensi status yang TIDAK boleh dicampur:
 *  - status highlight  (AnnotationStatus)  — per catatan;
 *  - status Request Revisi (RevisionStatus) — per REV-NNN;
 *  - status pekerjaan (orders.status, src/lib/status.ts) — tidak diubah oleh modul ini kecuali lewat aksi
 *    workflow QC yang SUDAH ada (record_feedback), lihat applyWorkflowAction.
 */

export const ANNOTATION_STATUSES = ["not_submitted", "waiting_pic", "waiting_clarification", "in_progress", "waiting_check", "done"] as const;
export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number];
export const ANNOTATION_STATUS_LABEL: Record<AnnotationStatus, string> = {
  not_submitted: "Belum diajukan",
  waiting_pic: "Menunggu PIC",
  waiting_clarification: "Menunggu Klarifikasi",
  in_progress: "Sedang diperbaiki",
  waiting_check: "Menunggu Pemeriksaan",
  done: "Selesai",
};

export const REVISION_STATUSES = ["draft", "waiting_pic", "in_progress", "waiting_requester_check", "approved", "resubmitted"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];
export const REVISION_STATUS_LABEL: Record<RevisionStatus, string> = {
  draft: "Draft",
  waiting_pic: "Menunggu PIC",
  in_progress: "Sedang Dikerjakan",
  waiting_requester_check: "Menunggu Pemeriksaan Pemohon",
  approved: "Disetujui",
  resubmitted: "Diajukan Kembali",
};

/** Request Revisi yang belum selesai: menahan persetujuan akhir hasil. */
export const OPEN_REVISION_STATUSES: readonly RevisionStatus[] = ["waiting_pic", "in_progress", "waiting_requester_check"];
export const isOpenRevision = (s: RevisionStatus) => OPEN_REVISION_STATUSES.includes(s);

export const ANNOTATION_KINDS = ["area", "text", "manual"] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];
export const ANNOTATION_KIND_LABEL: Record<AnnotationKind, string> = { area: "Area", text: "Teks", manual: "Referensi manual" };

export type AuthorKind = "requester" | "staff" | "manager" | "super_admin";
export const AUTHOR_KIND_LABEL: Record<AuthorKind, string> = { requester: "Pemohon", staff: "PIC", manager: "Manager", super_admin: "Super Admin" };

export const COMMENT_KINDS = ["comment", "clarification_request", "clarification_answer"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export const formatAnnotationNumber = (n: number) => `#${String(n).padStart(3, "0")}`;
export const formatRevisionNumber = (n: number) => `REV-${String(n).padStart(3, "0")}`;

// ---------------------------------------------------------------- geometri ternormalisasi

/** Persegi dalam koordinat 0–1 relatif terhadap ukuran halaman/gambar (bukan piksel). */
export type NormRect = { x: number; y: number; w: number; h: number };
export type PixelRect = { left: number; top: number; width: number; height: number };

export const MAX_RECTS_PER_ANNOTATION = 80;
const EPS = 1e-6;

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Piksel (relatif ke kotak halaman yang ditampilkan) → koordinat ternormalisasi. Hasil dijepit ke 0–1. */
export function normalizeRect(rect: PixelRect, box: { width: number; height: number }): NormRect | null {
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const x = clamp01(rect.left / box.width);
  const y = clamp01(rect.top / box.height);
  const w = clamp01((rect.left + rect.width) / box.width) - x;
  const h = clamp01((rect.top + rect.height) / box.height) - y;
  if (!(w > EPS) || !(h > EPS)) return null;
  return { x, y, w, h };
}

/** Koordinat ternormalisasi → persen CSS (dirender sebagai left/top/width/height persen; ikut skala saat zoom). */
export function rectToPercentStyle(r: NormRect): { left: string; top: string; width: string; height: string } {
  return { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` };
}

/** Koordinat ternormalisasi → piksel pada ukuran tampilan tertentu (untuk pengujian & perhitungan posisi). */
export function rectToPixels(r: NormRect, box: { width: number; height: number }): PixelRect {
  return { left: r.x * box.width, top: r.y * box.height, width: r.w * box.width, height: r.h * box.height };
}

/**
 * Gabungkan persegi seleksi teks yang berada pada baris yang sama dan saling menempel/tumpang tindih
 * (browser mengembalikan satu persegi per rentang teks) — mengurangi jumlah persegi yang disimpan.
 */
export function mergeLineRects(rects: NormRect[]): NormRect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: NormRect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const sameLine = last && Math.abs(last.y - r.y) < Math.max(last.h, r.h) * 0.5 && Math.abs(last.h - r.h) < Math.max(last.h, r.h) * 0.6;
    if (last && sameLine && r.x <= last.x + last.w + 0.01) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      const top = Math.min(last.y, r.y);
      const bottom = Math.max(last.y + last.h, r.y + r.h);
      last.x = Math.min(last.x, r.x);
      last.w = right - last.x;
      last.y = top;
      last.h = bottom - top;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

export type Geometry = { rects: NormRect[] };

/** Validasi geometri dari klien (server tidak mempercayai klien): 1–80 persegi, semua 0–1 dan di dalam halaman. */
export function parseGeometry(input: unknown): Geometry | null {
  if (!input || typeof input !== "object") return null;
  const rects = (input as { rects?: unknown }).rects;
  if (!Array.isArray(rects) || rects.length < 1 || rects.length > MAX_RECTS_PER_ANNOTATION) return null;
  const out: NormRect[] = [];
  for (const r of rects) {
    if (!r || typeof r !== "object") return null;
    const { x, y, w, h } = r as Record<string, unknown>;
    if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    const [nx, ny, nw, nh] = [x, y, w, h] as number[];
    if (nx < 0 || ny < 0 || nw <= EPS || nh <= EPS || nx + nw > 1 + 1e-4 || ny + nh > 1 + 1e-4) return null;
    out.push({ x: nx, y: ny, w: Math.min(nw, 1 - nx), h: Math.min(nh, 1 - ny) });
  }
  return { rects: out };
}

// ---------------------------------------------------------------- aturan pemilihan revisi

export type SelectableAnnotation = { id: string; number: number; status: AnnotationStatus };

/** Highlight yang boleh dimasukkan ke Request Revisi BARU: hanya yang belum pernah diajukan (atau dilepas kembali). */
export const canSelectForRevision = (a: Pick<SelectableAnnotation, "status">) => a.status === "not_submitted";

/**
 * Pemeriksaan pilihan highlight untuk satu Request Revisi (dipakai server DAN UI). null = valid.
 * Highlight yang sudah masuk revisi aktif, sedang menunggu klarifikasi, atau sudah selesai tidak boleh dipilih lagi.
 */
export function revisionSelectionProblem(selectedIds: string[], annotations: SelectableAnnotation[]): string | null {
  if (selectedIds.length === 0) return "Pilih minimal satu highlight untuk Request Revisi.";
  if (new Set(selectedIds).size !== selectedIds.length) return "Highlight yang sama dipilih lebih dari sekali.";
  const byId = new Map(annotations.map((a) => [a.id, a]));
  for (const id of selectedIds) {
    const a = byId.get(id);
    if (!a) return "Ada highlight yang tidak ditemukan pada pekerjaan ini.";
    if (!canSelectForRevision(a)) {
      return `Highlight ${formatAnnotationNumber(a.number)} tidak dapat dipilih: statusnya "${ANNOTATION_STATUS_LABEL[a.status]}".`;
    }
  }
  return null;
}

/** Persetujuan AKHIR hasil ditolak selama masih ada Request Revisi yang belum selesai. null = boleh. */
export function finalApprovalProblem(revisions: { number: number; status: RevisionStatus }[]): string | null {
  const open = revisions.filter((r) => isOpenRevision(r.status));
  if (open.length === 0) return null;
  const list = open.map((r) => `${formatRevisionNumber(r.number)} (${REVISION_STATUS_LABEL[r.status]})`).join(", ");
  return `Masih ada Request Revisi yang belum selesai: ${list}. Selesaikan atau ajukan kembali lebih dulu sebelum menyetujui hasil akhir.`;
}

/** Status highlight setelah sebuah Request Revisi berpindah status (aturan tunggal untuk server & pengujian). */
export function annotationStatusAfterRevision(current: AnnotationStatus, event: "created" | "started" | "delivered" | "approved" | "resubmitted"): AnnotationStatus {
  switch (event) {
    case "created":
      return current === "not_submitted" ? "waiting_pic" : current;
    case "started":
      return current === "waiting_pic" ? "in_progress" : current;
    case "delivered":
      return current === "waiting_pic" || current === "in_progress" || current === "waiting_clarification" ? "waiting_check" : current;
    case "approved":
      return current === "waiting_check" ? "done" : current;
    case "resubmitted":
      return current === "waiting_check" ? "not_submitted" : current;
  }
}

// ---------------------------------------------------------------- tipe tampilan (API → UI)

export type ReviewComment = {
  id: string;
  annotationId: string;
  body: string;
  kind: CommentKind;
  authorKind: AuthorKind;
  authorName: string;
  at: string;
};

export type ReviewAnnotation = {
  id: string;
  number: number;
  deliveryId: string;
  versionNo: number;
  attachmentId: string | null;
  linkId: string | null;
  kind: AnnotationKind;
  page: number | null;
  geometry: Geometry | null;
  quote: string | null;
  reference: string | null;
  status: AnnotationStatus;
  createdByKind: AuthorKind;
  createdByName: string;
  at: string;
  comments: ReviewComment[];
  /** Nomor REV terbaru yang memuat highlight ini (null bila belum pernah diajukan). */
  revisionNumber: number | null;
};

export type ReviewRevision = {
  id: string;
  number: number;
  status: RevisionStatus;
  note: string | null;
  reviewedVersionNo: number;
  deliveredVersionNo: number | null;
  requestedByName: string;
  at: string;
  startedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  resubmittedAt: string | null;
  annotationIds: string[];
};

export type PreviewKind = "pdf" | "image" | "presentation" | "none";

export type ReviewVersionFile = { id: string; fileName: string; mimeType: string; previewKind: PreviewKind };
export type ReviewVersionLink = { id: string; title: string; url: string };
export type ReviewVersion = {
  deliveryId: string;
  versionNo: number;
  at: string;
  deliveredBy: string | null;
  files: ReviewVersionFile[];
  links: ReviewVersionLink[];
  /** Pemohon sudah memutuskan atas pengiriman ini (lihat PublicDelivery.decision). */
  decision: "awaiting" | "approved" | "revision_requested";
  isLatest: boolean;
};

export type ReviewPermissions = {
  canAnnotate: boolean;
  canComment: boolean;
  /** PIC meminta klarifikasi (status highlight → Menunggu Klarifikasi). */
  canClarify: boolean;
  canStartRevision: boolean;
  /** Pemohon boleh membuat Request Revisi / menyetujui / mengajukan kembali (hasil terbaru menunggu keputusannya). */
  canRequestRevision: boolean;
  canApproveRevision: boolean;
  /** Pemohon boleh memberi persetujuan akhir (tidak ada REV terbuka). */
  canFinalApprove: boolean;
  finalApprovalBlockedReason: string | null;
  readOnly: boolean;
};

export type ReviewState = {
  orderId: string | null;
  orderNumber: string;
  orderClosed: boolean;
  viewer: "requester" | "staff" | "manager" | "super_admin";
  versions: ReviewVersion[];
  annotations: ReviewAnnotation[];
  revisions: ReviewRevision[];
  permissions: ReviewPermissions;
};

export function previewKindOf(mimeType: string, fileName: string): PreviewKind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp") return "image";
  if (ext === "ppt" || ext === "pptx") return "presentation";
  return "none";
}

/** URL tampilan (inline) berkas dokumen sesuai konteks. Berkas selalu lewat endpoint yang memeriksa hak akses. */
export function documentUrl(ctx: { mode: "requester"; orderNumber: string } | { mode: "internal" }, fileId: string, opts: { preview?: boolean } = {}): string {
  if (ctx.mode === "requester") {
    return opts.preview
      ? `/api/public/tracking/preview/${fileId}?order=${encodeURIComponent(ctx.orderNumber)}`
      : `/api/public/tracking/files/${fileId}?order=${encodeURIComponent(ctx.orderNumber)}&inline=1`;
  }
  return opts.preview ? `/api/internal/attachments/${fileId}/preview` : `/api/internal/attachments/${fileId}?inline=1`;
}
