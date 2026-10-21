import "server-only";
import { resolveDriveConfig, type DriveConfig } from "@/lib/server/drive/config";
import { GoogleDriveClient, type DriveClient, type DriveFile } from "@/lib/server/drive/client";
import { refreshAccessToken } from "@/lib/server/drive/oauth-client";
import { getDecryptedRefreshToken, getOAuthConnection } from "@/lib/server/repositories/drive-oauth";
import { DriveApiError, driveResultFolderPath, sanitizeDriveSegment, type ResultCategory } from "@/lib/drive";

export { type DriveClient, type DriveFile } from "@/lib/server/drive/client";
export { DriveApiError, isRetryableDriveError, driveFolderPath, driveResultFolderPath, driveResultFileName, type ResultCategory } from "@/lib/drive";
export { isDriveEnabled, resolveDriveConfig } from "@/lib/server/drive/config";

declare global {
  var __dticDriveClient: { config: DriveConfig; client: DriveClient } | undefined;
  /** Hanya dipakai test: paksa pakai klien palsu alih-alih Google sungguhan. */
  var __dticDriveClientOverride: DriveClient | undefined;
  /** Access token OAuth (bukan refresh token) — cache dalam proses, sama seperti token service account. */
  var __dticOAuthAccessToken: { value: string; expiresAt: number } | undefined;
}

export class DriveNotConfiguredError extends Error {
  constructor(problem: string | null) {
    super(problem ?? "Integrasi Google Drive belum dikonfigurasi.");
    this.name = "DriveNotConfiguredError";
  }
}

/** Klien Drive untuk proses ini, atau null bila belum dikonfigurasi (fitur nonaktif — bukan error). */
export function driveClientOrNull(): DriveClient | null {
  if (globalThis.__dticDriveClientOverride) return globalThis.__dticDriveClientOverride;
  const cfg = resolveDriveConfig(process.env);
  if (!cfg.ok) return null;
  const cached = globalThis.__dticDriveClient;
  if (cached && cached.config.ok && cfg.ok && cached.config.serviceAccountEmail === cfg.serviceAccountEmail && cached.config.rootFolderId === cfg.rootFolderId) {
    return cached.client;
  }
  const client = GoogleDriveClient.withServiceAccount(cfg.serviceAccountEmail, cfg.privateKeyPem, cfg.sharedDriveId);
  globalThis.__dticDriveClient = { config: cfg, client };
  return client;
}

/** Konfigurasi Drive wajib valid; lempar bila belum. Dipakai jalur yang sudah memutuskan memakai Drive. */
function requireConfig(): Extract<DriveConfig, { ok: true }> {
  const cfg = resolveDriveConfig(process.env);
  if (!cfg.ok) throw new DriveNotConfiguredError(cfg.problem);
  return cfg;
}

/** Klien service account wajib ada; lempar bila belum dikonfigurasi. */
function serviceAccountClient(): DriveClient {
  requireConfig();
  const client = driveClientOrNull();
  if (!client) throw new DriveNotConfiguredError(null);
  return client;
}

/**
 * Klien OAuth (akun pemilik folder) bila SUDAH terhubung, atau null bila belum — TIDAK melempar, karena
 * belum terhubung adalah kondisi normal (fitur ini opsional, lihat migration 20261020010000_drive_oauth).
 */
async function oauthClientOrNull(): Promise<DriveClient | null> {
  if (globalThis.__dticDriveClientOverride) return null; // override test selalu lewat jalur service account
  const conn = await getOAuthConnection();
  if (!conn.connected) return null;
  const refreshToken = await getDecryptedRefreshToken();
  if (!refreshToken) return null;
  const cfg = resolveDriveConfig(process.env);
  const sharedDriveId = cfg.ok ? cfg.sharedDriveId : null;
  const getAccessToken = async (): Promise<string> => {
    const cached = globalThis.__dticOAuthAccessToken;
    if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.value;
    const { accessToken, expiresIn } = await refreshAccessToken(refreshToken);
    globalThis.__dticOAuthAccessToken = { value: accessToken, expiresAt: Date.now() + expiresIn * 1000 };
    return accessToken;
  };
  return GoogleDriveClient.withOAuth(getAccessToken, sharedDriveId);
}

/**
 * Klien Drive aktif untuk proses ini. OAuth (akun pemilik folder) DIUTAMAKAN bila sudah terhubung — service
 * account TIDAK memiliki kuota penyimpanan sendiri dan gagal (HTTP 403) saat mengunggah isi file ke folder
 * My Drive biasa (lihat src/lib/server/drive/oauth-client.ts). Jatuh ke service account bila OAuth belum
 * terhubung — tetap berfungsi untuk operasi metadata (folder) seperti sebelumnya.
 */
export async function driveClient(): Promise<DriveClient> {
  const oauth = await oauthClientOrNull();
  if (oauth) return oauth;
  return serviceAccountClient();
}

/** Cari-atau-buat subfolder (idempoten: dua panggilan bersamaan paling buruk membuat satu folder duplikat bernama sama — jarang dan tidak merusak data). */
async function ensureFolder(client: DriveClient, parentId: string, name: string): Promise<string> {
  const existing = await client.findFolder(parentId, name);
  if (existing) return existing.id;
  const created = await client.createFolder(parentId, name);
  return created.id;
}

export type DriveConnectionTest = { ok: true; folderName: string } | { ok: false; message: string };

/**
 * Uji koneksi nyata ke Google Drive: autentikasi service account lalu pastikan folder akar (Drive A) bisa
 * diakses. Hanya membaca metadata (nama folder) — tidak pernah mengunggah/mengubah apa pun. Dipakai tombol
 * "Uji Koneksi" di dashboard Super Admin; hasilnya (ok/pesan) TIDAK PERNAH memuat token/private key (pesan
 * DriveApiError sudah disusun tanpa nilai rahasia — lihat src/lib/server/drive/client.ts).
 */
export async function testDriveConnection(): Promise<DriveConnectionTest> {
  const cfg = resolveDriveConfig(process.env);
  if (!cfg.ok) return { ok: false, message: cfg.problem ?? "Konfigurasi Google Drive belum diisi." };
  try {
    const client = await driveClient();
    const folder = await client.getFolderMetadata(cfg.rootFolderId);
    if (!folder) {
      return {
        ok: false,
        message: "Folder tujuan tidak ditemukan atau service account tidak memiliki akses. Pastikan folder sudah dibagikan ke alamat service account sebagai Editor.",
      };
    }
    return { ok: true, folderName: folder.name };
  } catch (error) {
    if (error instanceof DriveApiError) return { ok: false, message: error.message };
    return { ok: false, message: "Tidak dapat menghubungi Google Drive." };
  }
}

/**
 * Folder "{PIC Utama}/{Tahun}/{Bulan}/{Tanggal_NomorOrder_Pemohon_Jenis}/{Kategori}[/Revisi-NN]" (lihat
 * driveResultFolderPath di src/lib/drive.ts untuk aturan penamaan lengkap). Dibuat sesuai kebutuhan (lazy),
 * idempoten (find-or-create di setiap tingkat) — dua panggilan bersamaan paling buruk membuat satu folder
 * duplikat bernama sama di satu tingkat, tidak pernah menggandakan seluruh cabang.
 */
export async function ensureResultCategoryFolder(input: {
  picName: string | null;
  submittedAt: Date;
  requesterName: string;
  orderNumber: string;
  orderTitle: string;
  category: ResultCategory;
}): Promise<string> {
  const cfg = requireConfig();
  const client = await driveClient();
  let parent = cfg.rootFolderId;
  for (const segment of driveResultFolderPath(input)) parent = await ensureFolder(client, parent, segment);
  return parent;
}

/**
 * Sama seperti ensureResultCategoryFolder TAPI TIDAK PERNAH membuat folder (hanya mencari) — dipakai
 * sinkronisasi metadata (Fase 3/6): sinkronisasi tidak boleh membuat folder baru, hanya membaca yang
 * sudah ada. null bila folder kategori ini belum pernah dibuat sama sekali (belum ada upload ke sana).
 */
export async function findResultCategoryFolder(input: {
  picName: string | null;
  submittedAt: Date;
  requesterName: string;
  orderNumber: string;
  orderTitle: string;
  category: ResultCategory;
}): Promise<string | null> {
  const cfg = requireConfig();
  const client = await driveClient();
  let parent = cfg.rootFolderId;
  for (const segment of driveResultFolderPath(input)) {
    const found = await client.findFolder(parent, segment);
    if (!found) return null;
    parent = found.id;
  }
  return parent;
}

export type DriveUploadResult = { file: DriveFile; folderId: string };

/**
 * Unggah satu file hasil ke Drive A, idempoten lewat idempotencyKey (upload_key milik DTIC Nexus — SAMA
 * dengan kunci yang sudah dipakai untuk mencegah duplikasi di storage lokal/Supabase). Aman dipanggil
 * ulang: jika Drive sudah pernah menerima file ini (mis. permintaan sebelumnya timeout setelah Drive
 * menerimanya), panggilan ini menemukan file yang sama alih-alih mengunggah lagi.
 */
export async function uploadResultToDrive(input: {
  folderId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  idempotencyKey: string;
}): Promise<DriveUploadResult> {
  const client = await driveClient();
  const file = await client.uploadFile({ folderId: input.folderId, fileName: input.fileName, mimeType: input.mimeType, bytes: input.bytes, idempotencyKey: input.idempotencyKey });
  return { file, folderId: input.folderId };
}

/**
 * Pindahkan file hasil yang sudah tersinkron ke folder kategori lain (mis. draf → Hasil Awal, atau Hasil
 * Awal → Revisi-01, atau → Hasil Final) saat statusnya berubah lewat alur QC yang SUDAH ADA (lihat
 * src/lib/server/repositories/qc.ts). Tidak pernah menggandakan file — memindahkan objek yang sama.
 */
export async function moveResultFileToFolder(fileId: string, fromFolderId: string, toFolderId: string, newName?: string): Promise<void> {
  const client = await driveClient();
  await client.moveFile(fileId, fromFolderId, toFolderId, newName);
}

export type MemberFolderSyncItem =
  | { memberId: string; memberName: string; folderId: string; created: boolean }
  | { memberId: string; memberName: string; error: string };

export type MemberFolderSyncResult = {
  items: MemberFolderSyncItem[];
  createdCount: number;
  existingCount: number;
  failedCount: number;
};

/**
 * Satu folder per anggota aktif LANGSUNG di bawah folder akar Drive A (TANPA folder perantara seperti
 * "01_ANGGOTA_DTIC") — struktur hasil kerja ("{PIC}/{Tahun}/{Tanggal}/{Pemohon}/{Kategori}") dibuat lazy saat
 * ada order, terpisah dari folder identitas anggota ini. Idempoten: memakai ensureFolder (cari-atau-buat)
 * per anggota, jadi aman dijalankan berulang kali — tidak pernah menggandakan folder anggota yang sudah ada.
 * Satu anggota gagal tidak menghentikan anggota lain (dikumpulkan sebagai item error, bukan dilempar).
 */
export async function syncMemberFolders(members: { id: string; name: string }[]): Promise<MemberFolderSyncResult> {
  const cfg = requireConfig();
  const client = await driveClient();
  const items: MemberFolderSyncItem[] = [];
  let createdCount = 0;
  let existingCount = 0;
  let failedCount = 0;
  for (const member of members) {
    const folderName = sanitizeDriveSegment(member.name, member.id);
    try {
      const existing = await client.findFolder(cfg.rootFolderId, folderName);
      if (existing) {
        items.push({ memberId: member.id, memberName: member.name, folderId: existing.id, created: false });
        existingCount += 1;
      } else {
        const created = await client.createFolder(cfg.rootFolderId, folderName);
        items.push({ memberId: member.id, memberName: member.name, folderId: created.id, created: true });
        createdCount += 1;
      }
    } catch (error) {
      const message = error instanceof DriveApiError ? error.message : "Tidak dapat menghubungi Google Drive.";
      items.push({ memberId: member.id, memberName: member.name, error: message });
      failedCount += 1;
    }
  }
  return { items, createdCount, existingCount, failedCount };
}

