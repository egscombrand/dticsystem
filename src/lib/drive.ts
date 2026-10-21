/**
 * Aturan murni Google Drive (MURNI: tanpa "server-only", tanpa I/O, diuji unit). Dipakai server; tidak
 * pernah memanggil Google — hanya mengklasifikasikan error dan menyusun nama/jalur.
 */
import { getZonedParts } from "@/lib/dates";
import type { StatusTone } from "@/lib/status";

export class DriveApiError extends Error {
  constructor(
    message: string,
    /** "transient" boleh dicoba ulang (timeout, 429, 5xx); "permanent" tidak (403 izin, 404, dsb). */
    public readonly kind: "transient" | "permanent",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "DriveApiError";
  }
}

/** true bila error Drive aman dicoba ulang (timeout, 429, 5xx); false bila permanen (izin, kuota berhenti, dll). */
export function isRetryableDriveError(error: unknown): boolean {
  return error instanceof DriveApiError && error.kind === "transient";
}

/** Status sinkron yang ditampilkan ke pengguna, diturunkan dari hasil percobaan terakhir. */
export const DRIVE_SYNC_STATUSES = ["pending", "synced", "failed"] as const;
export type DriveSyncStatus = (typeof DRIVE_SYNC_STATUSES)[number];
export const DRIVE_SYNC_LABEL: Record<DriveSyncStatus, string> = {
  pending: "Menunggu diunggah ke Drive",
  synced: "Tersimpan di Google Drive",
  failed: "Gagal disinkronkan ke Drive",
};

/** "Drive A/<tahun>/<nomor order>" — nomor order (identitas internal), bukan judul/nama dari pengguna. */
export function driveFolderPath(orderNumber: string, year: number): string[] {
  return [String(year), orderNumber];
}

/**
 * Sanitasi satu segmen nama folder/file Google Drive: buang karakter yang bermasalah di banyak OS/alat
 * sinkronisasi (\\/:*?"<>|), lipat spasi jadi "-", batasi panjang, dan JANGAN PERNAH kosong (pakai
 * `fallback` bila hasil sanitasi kosong — nama folder tidak boleh hilang hanya karena input aneh/kosong).
 */
export function sanitizeDriveSegment(raw: string, fallback: string): string {
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

/**
 * Jalur folder Drive untuk HASIL PEKERJAAN PIC (bukan dokumen pemohon — lihat catatan di
 * src/lib/server/repositories/results.ts tentang keterbatasan saat ini), struktur:
 *   DTICSystemNexus/{Nama_PIC}/{Tahun}/{Tanggal DD-MM-YYYY}/{Nama_Pemohon}/{NomorOrder - Judul}/{Kategori}
 *
 * "PIC Utama" = anggota yang PALING AWAL ditugaskan pada order ini yang MASIH ditugaskan sekarang (lihat
 * primaryAssigneeName di src/lib/server/repositories/orders.ts) — order_assignments tidak punya konsep
 * "PIC utama" eksplisit, jadi ini aturan yang dipilih & didokumentasikan secara eksplisit, bukan ditebak
 * diam-diam.
 *
 * `submittedAt` = waktu pengajuan QC PERTAMA kali untuk order ini (lihat firstQcSubmittedAt di
 * src/lib/server/repositories/qc.ts), BUKAN waktu order dibuat — folder arsip dikelompokkan berdasarkan
 * kapan hasil pertama kali diserahkan untuk diperiksa, sesuai aturan arsip yang disepakati. Sebelum
 * pengajuan QC pertama terjadi (file masih draf), pemanggil memakai waktu unggah sebagai nilai sementara
 * (lihat syncRowToDrive) — folder draf TIDAK dipindah ulang bila nilai sementara ini berbeda dari tanggal
 * pengajuan QC pertama yang sebenarnya; hanya kategori hasil (Hasil Awal/Revisi/Hasil Final) yang memakai
 * nilai final & konsisten (dihitung ulang setiap kali, lihat moveResultFilesToCategory).
 *
 * Segmen "{NomorOrder - Judul}" memisahkan arsip per PEKERJAAN, bukan hanya per pemohon — mencegah dua
 * pekerjaan dari pemohon+PIC+tanggal yang sama berbagi satu folder (lihat riwayat keputusan di AGENTS.md
 * sesi terkait; sebelum perubahan ini folder tidak memuat nomor order sama sekali).
 */
export type ResultCategory = "proses_pengerjaan" | "hasil_awal" | "revisi" | "hasil_final";
export const RESULT_CATEGORY_FOLDER: Record<ResultCategory, string> = {
  proses_pengerjaan: "02_Proses_Pengerjaan",
  hasil_awal: "03_Hasil_Awal",
  revisi: "04_Revisi",
  hasil_final: "05_Hasil_Final",
};

export function driveResultFolderPath(input: {
  picName: string | null;
  submittedAt: Date;
  requesterName: string;
  orderNumber: string;
  orderTitle: string;
  category: ResultCategory;
}): string[] {
  const p = getZonedParts(input.submittedAt);
  const year = String(p.year);
  const dateSegment = `${String(p.day).padStart(2, "0")}-${String(p.month).padStart(2, "0")}-${year}`;
  const orderNumber = sanitizeDriveSegment(input.orderNumber, "Order");
  const orderTitle = sanitizeDriveSegment(input.orderTitle, "Pekerjaan").slice(0, 50);
  return [
    sanitizeDriveSegment(input.picName ?? "", "Belum-Ada-PIC"),
    year,
    dateSegment,
    sanitizeDriveSegment(input.requesterName, "Pemohon"),
    `${orderNumber} - ${orderTitle}`,
    RESULT_CATEGORY_FOLDER[input.category],
  ];
}

/**
 * Nama file hasil pekerjaan: "{NomorOrder}_{JenisPekerjaan}_{TipeFile}_v{NN}_{TanggalUpload}.{ext}".
 * `version` = urutan ke berapa file hasil ini di antara seluruh file hasil order ini (1, 2, 3, ...), BUKAN
 * nomor revisi QC — dua file di revisi yang sama tetap punya versi berbeda bila diunggah terpisah.
 */
export function driveResultFileName(input: {
  orderNumber: string;
  requesterName: string;
  picName: string | null;
  designType: string;
  category: ResultCategory;
  revisionNumber?: number;
  version: number;
  uploadedAt: Date;
  ext: string;
}): string {
  const tipe = input.category === "hasil_awal" ? "Hasil-Awal" : input.category === "hasil_final" ? "FINAL" : input.category === "revisi" ? `Revisi-${String(input.revisionNumber ?? 1).padStart(2, "0")}` : "Draf";
  const p = getZonedParts(input.uploadedAt);
  const year = String(p.year);
  // Identitas lengkap LANGSUNG di nama file (bukan hanya di jalur folder) — file tetap bisa dikenali
  // sepenuhnya walau dipindah/diunduh lepas dari foldernya (nomor, pemohon, PIC, tahun, jenis, kategori, versi).
  // Setiap bagian disanitasi & DIPOTONG SENDIRI-SENDIRI (bukan string gabungan) — nama pemohon/PIC yang
  // panjang tidak boleh memotong akhiran "_v{NN}" (akhiran itu satu-satunya pembeda antar-versi file).
  const orderNumber = sanitizeDriveSegment(input.orderNumber, "Order");
  const requester = sanitizeDriveSegment(input.requesterName, "Pemohon").slice(0, 40);
  const pic = sanitizeDriveSegment(input.picName ?? "Belum-Ada-PIC", "Belum-Ada-PIC").slice(0, 40);
  const designType = sanitizeDriveSegment(input.designType, "Desain").slice(0, 30);
  const base = `${orderNumber}_${requester}_${pic}_${year}_${designType}_${tipe}_v${String(input.version).padStart(2, "0")}`;
  return `${base}.${input.ext}`;
}

/**
 * Status integrasi untuk dashboard Super Admin (MURNI: diturunkan dari config + status tersimpan, tanpa I/O).
 * "active_config_broken" sengaja dipisah dari "active": menu diaktifkan sebelumnya, tetapi konfigurasi env
 * sekarang tidak valid lagi — upload baru TIDAK memakai Drive (isDriveActiveForUploads mewajibkan keduanya),
 * jadi status ini harus tampak bermasalah, bukan "aktif", walau baris enabled=true masih tersimpan.
 */
export type DriveAdminStatus = "not_configured" | "config_invalid" | "ready_untested" | "test_failed" | "connected_inactive" | "active" | "active_config_broken";

export function driveAdminStatus(input: { configOk: boolean; configProblem: string | null; enabled: boolean; lastTestOk: boolean | null }): DriveAdminStatus {
  if (input.enabled && !input.configOk) return "active_config_broken";
  if (!input.configOk) return input.configProblem === null ? "not_configured" : "config_invalid";
  if (input.enabled) return "active";
  if (input.lastTestOk === false) return "test_failed";
  if (input.lastTestOk === true) return "connected_inactive";
  return "ready_untested";
}

export const DRIVE_ADMIN_STATUS_LABEL: Record<DriveAdminStatus, string> = {
  not_configured: "Belum dikonfigurasi",
  config_invalid: "Konfigurasi tidak lengkap atau tidak valid",
  ready_untested: "Konfigurasi siap, belum diuji",
  test_failed: "Pengujian koneksi gagal",
  connected_inactive: "Koneksi berhasil, integrasi belum diaktifkan",
  active: "Integrasi aktif",
  active_config_broken: "Integrasi aktif, tetapi konfigurasi sekarang bermasalah",
};

export const DRIVE_ADMIN_STATUS_TONE: Record<DriveAdminStatus, StatusTone> = {
  not_configured: "neutral",
  config_invalid: "warning",
  ready_untested: "info",
  test_failed: "danger",
  connected_inactive: "warning",
  active: "success",
  active_config_broken: "danger",
};
