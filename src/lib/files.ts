import { UPLOAD_LIMITS } from "@/lib/config/app";

/** Jenis dokumen pendukung yang diizinkan (ekstensi → MIME yang disimpan). */
export const ALLOWED_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
};

export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED_FILE_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

export const ALLOWED_EXTENSIONS_LABEL = "PDF, JPG, PNG, WEBP, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT";

export function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`;
}

/** Validasi ringan yang juga dipakai di browser (server tetap memvalidasi ulang + memeriksa isi file). */
export function checkFileBasics(file: { name: string; size: number }): string | null {
  const ext = getExtension(file.name);
  if (!ALLOWED_FILE_TYPES[ext]) return `Format "${file.name}" tidak didukung. Gunakan ${ALLOWED_EXTENSIONS_LABEL}.`;
  if (file.size <= 0) return `File "${file.name}" kosong.`;
  if (file.size > UPLOAD_LIMITS.maxFileSizeBytes)
    return `File "${file.name}" melebihi batas ${formatFileSize(UPLOAD_LIMITS.maxFileSizeBytes)}.`;
  return null;
}

/** Nama file tampilan yang aman: tanpa path, karakter kontrol, atau karakter berbahaya. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const trimmed = cleaned.slice(-150);
  return trimmed.length > 0 ? trimmed : "file";
}

const startsWith = (buf: Uint8Array, sig: number[], offset = 0) => sig.every((b, i) => buf[offset + i] === b);

/**
 * Memastikan isi file sesuai ekstensinya (magic bytes), sehingga file berbahaya
 * tidak bisa disamarkan hanya dengan mengganti ekstensi.
 */
export function contentMatchesExtension(ext: string, head: Uint8Array): boolean {
  switch (ext) {
    case "pdf":
      return startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case "png":
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case "webp":
      return startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8);
    case "docx":
    case "xlsx":
    case "pptx":
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]); // ZIP container
    case "doc":
    case "xls":
    case "ppt":
      return startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // OLE2
    case "txt": {
      // Teks biasa: tidak boleh mengandung byte NUL
      return !head.includes(0);
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// File hasil pekerjaan (diunggah PIC). Termasuk format desain & arsip; pratinjau hanya untuk gambar & PDF.
// ---------------------------------------------------------------------------

export const RESULT_FILE_TYPES: Record<string, string> = {
  ...ALLOWED_FILE_TYPES,
  psd: "image/vnd.adobe.photoshop",
  ai: "application/postscript",
  svg: "image/svg+xml",
  zip: "application/zip",
};

export const RESULT_ACCEPT_ATTRIBUTE = Object.keys(RESULT_FILE_TYPES).map((ext) => `.${ext}`).join(",");
export const RESULT_EXTENSIONS_LABEL = "JPG, PNG, WEBP, PDF, PSD, AI, SVG, ZIP, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT";
/** Batas jumlah file hasil per penyerahan. */
export const RESULT_MAX_FILES_PER_HANDOVER = 10;
/** Format yang dapat dipratinjau browser lewat endpoint lampiran (sama dengan INLINE_TYPES di server). */
export const PREVIEWABLE_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

/** Validasi ringan file hasil (browser & server). Server tetap memeriksa isi file. */
export function checkResultFileBasics(file: { name: string; size: number }, maxBytes: number): string | null {
  const ext = getExtension(file.name);
  if (!RESULT_FILE_TYPES[ext]) return `Format "${file.name}" tidak didukung. Gunakan ${RESULT_EXTENSIONS_LABEL}.`;
  if (file.size <= 0) return `File "${file.name}" kosong.`;
  if (file.size > maxBytes) return `File "${file.name}" melebihi batas ${formatFileSize(maxBytes)}.`;
  return null;
}

/** Pemeriksaan isi file hasil (magic bytes / penanda teks). `head` = hingga 1 KB pertama. */
export function resultContentMatches(ext: string, head: Uint8Array): boolean {
  switch (ext) {
    case "psd":
      return startsWith(head, [0x38, 0x42, 0x50, 0x53]); // 8BPS
    case "ai":
      // Illustrator modern berbasis PDF; versi lama PostScript.
      return startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d]) || startsWith(head, [0x25, 0x21, 0x50, 0x53]);
    case "zip":
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06]);
    case "svg": {
      if (head.includes(0)) return false;
      const text = new TextDecoder().decode(head).toLowerCase();
      return text.includes("<svg");
    }
    default:
      return contentMatchesExtension(ext, head.subarray(0, 16));
  }
}
