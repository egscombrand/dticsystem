import "server-only";
import { DriveApiError } from "@/lib/drive";

/**
 * Klien Google Drive API v3 minimal (REST langsung, tanpa SDK "googleapis" — konsisten dengan pola proyek
 * ini yang memanggil Supabase Storage dan Telegram lewat fetch mentah, bukan SDK besar).
 *
 * Diuji end-to-end lewat server tiruan lokal (lihat scripts/e2e.mjs, pola yang sama dengan tiruan Telegram):
 * GOOGLE_OAUTH_TOKEN_URL/GOOGLE_DRIVE_API_BASE/GOOGLE_DRIVE_UPLOAD_BASE diarahkan ke server tiruan itu saat
 * pengujian, sehingga kode penandatanganan JWT, pemanggilan HTTP, dan penyusunan body multipart yang
 * SUNGGUHAN tetap teruji tanpa pernah menghubungi Google.
 */
export type DriveFolder = { id: string; name: string };
export type DriveFile = { id: string; name: string; webViewLink: string | null };
/** Metadata lengkap satu file (dipakai sinkronisasi — deteksi rename/pindah/hilang berdasarkan fileId, bukan nama). */
export type DriveFileMeta = { id: string; name: string; parents: string[]; modifiedTime: string; mimeType: string; size: number; trashed: boolean };

export interface DriveClient {
  /** Cari subfolder bernama `name` tepat di bawah `parentId`; null bila belum ada. */
  findFolder(parentId: string, name: string): Promise<DriveFolder | null>;
  /** Semua subfolder LANGSUNG di bawah `parentId` (tidak rekursif, tidak termasuk yang di-trash). */
  listFolders(parentId: string): Promise<DriveFolder[]>;
  /** Ambil metadata folder langsung lewat ID (uji koneksi: pastikan folder akar dapat diakses). null bila tidak ditemukan/tidak dapat diakses/bukan folder. */
  getFolderMetadata(folderId: string): Promise<DriveFolder | null>;
  /** Buat subfolder baru di bawah `parentId`. */
  createFolder(parentId: string, name: string): Promise<DriveFolder>;
  /**
   * Cari file yang sudah pernah diunggah dengan idempotencyKey ini (appProperties) di `folderId` — dipakai
   * SEBELUM upload agar retry/timeout tidak pernah menggandakan file di Drive.
   */
  findFileByIdempotencyKey(folderId: string, idempotencyKey: string): Promise<DriveFile | null>;
  /** Unggah satu file; idempotencyKey disimpan sebagai appProperties untuk pencarian di atas. */
  uploadFile(input: { folderId: string; fileName: string; mimeType: string; bytes: Uint8Array; idempotencyKey: string; extraProperties?: Record<string, string> }): Promise<DriveFile>;
  /** Unduh isi file sebagai stream. */
  downloadFile(fileId: string): Promise<ReadableStream<Uint8Array>>;
  /** Bagikan file ke alamat email tertentu (akses privat per-pengguna, bukan "siapa saja dengan tautan"). */
  shareWithEmail(fileId: string, email: string, role: "reader" | "writer"): Promise<void>;
  /** Pindahkan file ke folder lain (mis. draf → Hasil Awal/Revisi/Final saat status QC berubah), dan
   *  sekalian ganti nama file bila `newName` diisi (nama file Drive ikut mencerminkan kategori terbaru). */
  moveFile(fileId: string, fromFolderId: string, toFolderId: string, newName?: string): Promise<void>;
  /** Metadata lengkap satu file lewat ID (sinkronisasi: deteksi rename/pindah). null bila tidak ditemukan/di-trash/bukan file. */
  getFileMetadata(fileId: string): Promise<DriveFileMeta | null>;
  /** Semua file (BUKAN folder) LANGSUNG di bawah `parentId`, dipaginasi otomatis (tidak termasuk yang di-trash). */
  listFiles(parentId: string): Promise<DriveFileMeta[]>;
}

// Dapat ditimpa HANYA untuk pengujian (E2E mengarahkan ke server tiruan lokal, lihat scripts/e2e.mjs).
// Default selalu endpoint Google sungguhan; tidak pernah menghubungi Drive produksi tanpa konfigurasi eksplisit.
const tokenUrl = () => process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token";
const apiBase = () => process.env.GOOGLE_DRIVE_API_BASE || "https://www.googleapis.com/drive/v3";
const uploadBase = () => process.env.GOOGLE_DRIVE_UPLOAD_BASE || "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
// Dapat dipersingkat HANYA untuk pengujian timeout (lihat scripts/e2e.mjs); default wajar untuk produksi.
const REQUEST_TIMEOUT_MS = Number(process.env.GOOGLE_DRIVE_REQUEST_TIMEOUT_MS) || 20_000;

function base64url(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString("base64url");
}

/** Token akses OAuth2 cache dalam proses (dipakai ulang sampai dekat kedaluwarsa). Tidak pernah dicatat ke log. */
let cachedServiceAccountToken: { value: string; expiresAt: number } | null = null;

async function getServiceAccountAccessToken(email: string, privateKeyPem: string): Promise<string> {
  if (cachedServiceAccountToken && cachedServiceAccountToken.expiresAt - 60_000 > Date.now()) return cachedServiceAccountToken.value;
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/drive", aud: tokenUrl(), iat: now, exp: now + 3600 }),
  );
  const signingInput = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(privateKeyPem));
  const assertion = `${signingInput}.${signature}`;

  const res = await fetchWithTimeout(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) {
    // Pesan error Google untuk token bisa memuat detail; tidak pernah menyertakan assertion/private key di sini.
    throw new DriveApiError(`Autentikasi Google Drive gagal (HTTP ${res.status}).`, res.status >= 500 ? "transient" : "permanent", res.status);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedServiceAccountToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

export async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new DriveApiError("Permintaan ke Google Drive timeout.", "transient");
    throw new DriveApiError(`Tidak dapat menghubungi Google Drive: ${error instanceof Error ? error.message : "error jaringan"}.`, "transient");
  } finally {
    clearTimeout(t);
  }
}

/**
 * Google kadang membalas HTTP 403 (bukan 429) untuk batas laju per-pengguna ("userRateLimitExceeded" /
 * "rateLimitExceeded") — ini SEMENTARA (aman dicoba ulang), bukan masalah izin permanen seperti 403 lain
 * (mis. folder tidak dibagikan). Terbukti dari respons batch simulasi nyata (9 PIC berurutan tanpa jeda):
 * beberapa gagal persis dengan pesan "User rate limit exceeded" pada HTTP 403.
 */
function isRateLimitBody(status: number, bodyText: string): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  try {
    const parsed = JSON.parse(bodyText) as { error?: { errors?: { reason?: string }[] } };
    return (parsed.error?.errors ?? []).some((e) => e.reason === "userRateLimitExceeded" || e.reason === "rateLimitExceeded");
  } catch {
    return false;
  }
}

/** Coba ulang error transient (timeout, 429, 5xx, batas laju 403) dengan jeda membesar; error permanen langsung dilempar. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delaysMs = [500, 1500, 3500];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof DriveApiError) || error.kind !== "transient" || attempt >= delaysMs.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}

/**
 * Google Drive REST API v3 sungguhan. Sumber token akses DIINJEKSI (`tokenProvider`) — bisa service
 * account (JWT, selalu tersedia bila dikonfigurasi, tapi TIDAK memiliki kuota penyimpanan sendiri — lihat
 * DriveApiError "storage quota" saat upload) atau OAuth atas nama akun pemilik folder (memakai kuota akun
 * itu sendiri, lihat src/lib/server/drive/oauth-client.ts). Logika HTTP/multipart sama untuk keduanya.
 */
export class GoogleDriveClient implements DriveClient {
  constructor(
    private readonly tokenProvider: () => Promise<string>,
    private readonly sharedDriveId: string | null,
  ) {}

  static withServiceAccount(email: string, privateKeyPem: string, sharedDriveId: string | null): GoogleDriveClient {
    return new GoogleDriveClient(() => getServiceAccountAccessToken(email, privateKeyPem), sharedDriveId);
  }

  static withOAuth(getAccessToken: () => Promise<string>, sharedDriveId: string | null): GoogleDriveClient {
    return new GoogleDriveClient(getAccessToken, sharedDriveId);
  }

  private async token(): Promise<string> {
    return this.tokenProvider();
  }

  private driveParams(): string {
    // supportsAllDrives wajib untuk Shared Drive; includeItemsFromAllDrives + corpora diperlukan agar files.list menjangkau Shared Drive.
    return this.sharedDriveId
      ? `supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${encodeURIComponent(this.sharedDriveId)}`
      : "supportsAllDrives=true&includeItemsFromAllDrives=true";
  }

  private async request(path: string, init: RequestInit & { query?: string } = {}): Promise<Response> {
    return withRetry(async () => {
      const token = await this.token();
      const { query, ...rest } = init;
      const sep = path.includes("?") ? "&" : "?";
      const res = await fetchWithTimeout(`${apiBase()}${path}${sep}${query ?? ""}`, {
        ...rest,
        headers: { Authorization: `Bearer ${token}`, ...(rest.headers ?? {}) },
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        const retryable = res.status === 429 || res.status >= 500 || isRateLimitBody(res.status, bodyText);
        // Log server-side SAJA (tidak pernah dikirim ke client): respons Google tidak pernah memuat token/private
        // key, hanya detail error field/permintaan — aman dicatat untuk diagnosis akar masalah HTTP 4xx/5xx.
        console.error(`[drive] ${init.method ?? "GET"} ${path} -> HTTP ${res.status}: ${bodyText.slice(0, 2000)}`);
        let detail = "";
        try {
          detail = (JSON.parse(bodyText) as { error?: { message?: string } })?.error?.message ?? "";
        } catch {
          // respons non-JSON; abaikan detail
        }
        throw new DriveApiError(`Google Drive menolak permintaan (HTTP ${res.status})${detail ? `: ${detail}` : "."}`, retryable ? "transient" : "permanent", res.status);
      }
      return res;
    });
  }

  async findFolder(parentId: string, name: string): Promise<DriveFolder | null> {
    const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const res = await this.request("/files", { query: `q=${encodeURIComponent(q)}&fields=files(id,name)&${this.driveParams()}` });
    const data = (await res.json()) as { files: DriveFolder[] };
    return data.files[0] ?? null;
  }

  async listFolders(parentId: string): Promise<DriveFolder[]> {
    const q = `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const res = await this.request("/files", { query: `q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1000&${this.driveParams()}` });
    const data = (await res.json()) as { files: DriveFolder[] };
    return data.files;
  }

  async getFolderMetadata(folderId: string): Promise<DriveFolder | null> {
    try {
      const res = await this.request(`/files/${encodeURIComponent(folderId)}`, { query: `fields=id,name,mimeType&${this.driveParams()}` });
      const data = (await res.json()) as { id: string; name: string; mimeType: string };
      return data.mimeType === FOLDER_MIME ? { id: data.id, name: data.name } : null;
    } catch (error) {
      if (error instanceof DriveApiError && error.status === 404) return null;
      throw error;
    }
  }

  async createFolder(parentId: string, name: string): Promise<DriveFolder> {
    const res = await this.request("/files", {
      method: "POST",
      query: `fields=id,name&${this.driveParams()}`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    return (await res.json()) as DriveFolder;
  }

  async findFileByIdempotencyKey(folderId: string, idempotencyKey: string): Promise<DriveFile | null> {
    const q = `'${folderId}' in parents and appProperties has { key='idempotencyKey' and value='${idempotencyKey}' } and trashed = false`;
    const res = await this.request("/files", { query: `q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&${this.driveParams()}` });
    const data = (await res.json()) as { files: DriveFile[] };
    return data.files[0] ?? null;
  }

  async uploadFile(input: { folderId: string; fileName: string; mimeType: string; bytes: Uint8Array; idempotencyKey: string; extraProperties?: Record<string, string> }): Promise<DriveFile> {
    // Idempoten: cari dulu berdasarkan appProperties sebelum mengunggah — retry/timeout tidak menggandakan file.
    const existing = await this.findFileByIdempotencyKey(input.folderId, input.idempotencyKey);
    if (existing) return existing;

    const metadata = { name: input.fileName, parents: [input.folderId], appProperties: { idempotencyKey: input.idempotencyKey, ...input.extraProperties } };
    const boundary = `dtic-${input.idempotencyKey}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`),
      Buffer.from(input.bytes),
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    return withRetry(async () => {
      const token = await this.token();
      const res = await fetchWithTimeout(`${uploadBase()}/files?uploadType=multipart&fields=id,name,webViewLink&${this.driveParams()}`, {
        method: "POST",
        // boundary DIKUTIP: RFC 2045 mewajibkan tanda kutip bila nilainya memuat karakter "tspecial" (mis.
        // titik dua) — tanpa kutip, Google menolak header ini sebagai "Bad content type" (akar masalah nyata,
        // bukan tebakan: lihat idempotencyKey yang memuat ':' pada fitur simulasi data UAT).
        headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary="${boundary}"` },
        body,
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        const retryable = res.status === 429 || res.status >= 500 || isRateLimitBody(res.status, bodyText);
        console.error(`[drive] POST /upload/files (${input.fileName}) -> HTTP ${res.status}: ${bodyText.slice(0, 2000)}`);
        let detail = "";
        try {
          detail = (JSON.parse(bodyText) as { error?: { message?: string } })?.error?.message ?? "";
        } catch {
          // respons non-JSON; abaikan detail
        }
        throw new DriveApiError(`Unggah ke Google Drive gagal (HTTP ${res.status})${detail ? `: ${detail}` : "."}`, retryable ? "transient" : "permanent", res.status);
      }
      return (await res.json()) as DriveFile;
    });
  }

  async downloadFile(fileId: string): Promise<ReadableStream<Uint8Array>> {
    const res = await this.request(`/files/${encodeURIComponent(fileId)}`, { query: `alt=media&${this.driveParams()}` });
    if (!res.body) throw new DriveApiError("Google Drive tidak mengembalikan isi file.", "transient");
    return res.body;
  }

  async shareWithEmail(fileId: string, email: string, role: "reader" | "writer"): Promise<void> {
    await this.request(`/files/${encodeURIComponent(fileId)}/permissions`, {
      method: "POST",
      query: `sendNotificationEmail=false&${this.driveParams()}`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "user", role, emailAddress: email }),
    });
  }

  async moveFile(fileId: string, fromFolderId: string, toFolderId: string, newName?: string): Promise<void> {
    if (fromFolderId === toFolderId && !newName) return;
    const parentsQuery = fromFolderId === toFolderId ? "" : `addParents=${encodeURIComponent(toFolderId)}&removeParents=${encodeURIComponent(fromFolderId)}&`;
    await this.request(`/files/${encodeURIComponent(fileId)}`, {
      method: "PATCH",
      query: `${parentsQuery}fields=id&${this.driveParams()}`,
      headers: newName ? { "Content-Type": "application/json" } : undefined,
      body: newName ? JSON.stringify({ name: newName }) : undefined,
    });
  }

  async getFileMetadata(fileId: string): Promise<DriveFileMeta | null> {
    try {
      const res = await this.request(`/files/${encodeURIComponent(fileId)}`, { query: `fields=id,name,parents,modifiedTime,mimeType,size,trashed&${this.driveParams()}` });
      const data = (await res.json()) as { id: string; name: string; parents?: string[]; modifiedTime: string; mimeType: string; size?: string; trashed?: boolean };
      if (data.mimeType === FOLDER_MIME) return null;
      return { id: data.id, name: data.name, parents: data.parents ?? [], modifiedTime: data.modifiedTime, mimeType: data.mimeType, size: Number(data.size ?? 0), trashed: Boolean(data.trashed) };
    } catch (error) {
      if (error instanceof DriveApiError && error.status === 404) return null;
      throw error;
    }
  }

  async listFiles(parentId: string): Promise<DriveFileMeta[]> {
    const q = `'${parentId}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`;
    const out: DriveFileMeta[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.request("/files", {
        query: `q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,parents,modifiedTime,mimeType,size)&pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}&${this.driveParams()}`,
      });
      const data = (await res.json()) as { files: { id: string; name: string; parents?: string[]; modifiedTime: string; mimeType: string; size?: string }[]; nextPageToken?: string };
      for (const f of data.files) out.push({ id: f.id, name: f.name, parents: f.parents ?? [], modifiedTime: f.modifiedTime, mimeType: f.mimeType, size: Number(f.size ?? 0), trashed: false });
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }
}
