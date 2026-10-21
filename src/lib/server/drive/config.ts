/**
 * Pemilihan & validasi konfigurasi Google Drive (MURNI: tanpa "server-only", bisa diuji unit; tanpa I/O).
 * Nilai kosong ("") dianggap TIDAK diisi. Pesan galat hanya menyebut nama variabel, tidak pernah nilainya.
 *
 * Integrasi Drive bersifat OPSIONAL dan lepas dari storage lampiran yang sudah ada: bila konfigurasi tidak
 * lengkap, resolveDriveConfig() mengembalikan { ok: false } dan jalur upload tetap memakai
 * src/lib/server/storage (local/Supabase) persis seperti sebelum fitur ini ada — tidak ada perubahan
 * perilaku sampai variabel di bawah benar-benar diisi.
 */
export type DriveConfig =
  | {
      ok: true;
      serviceAccountEmail: string;
      privateKeyPem: string;
      rootFolderId: string;
      /** Shared Drive (opsional). Bila diisi, setiap panggilan API menyertakan supportsAllDrives + driveId. */
      sharedDriveId: string | null;
    }
  | { ok: false; problem: string | null };

const val = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/** PEM dari env: newline literal "\n" (umum di Vercel) diterjemahkan menjadi baris baru sungguhan. */
function normalizePrivateKey(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/**
 * Jika GOOGLE_SERVICE_ACCOUNT_JSON diisi (kredensial JSON service account dari Google Cloud Console,
 * ditempel apa adanya sebagai satu baris), email & private key diambil dari situ — lebih sederhana untuk
 * environment Vercel daripada dua variabel terpisah. Jika tidak, dua variabel terpisah dipakai.
 */
function readCredentials(env: Record<string, string | undefined>): { email: string; key: string } | { error: string } {
  const json = val(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (json) {
    try {
      const parsed = JSON.parse(json) as { client_email?: string; private_key?: string };
      if (!parsed.client_email || !parsed.private_key) return { error: "GOOGLE_SERVICE_ACCOUNT_JSON tidak memuat client_email/private_key." };
      return { email: parsed.client_email, key: normalizePrivateKey(parsed.private_key) };
    } catch {
      return { error: "GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON yang valid." };
    }
  }
  const email = val(env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const key = val(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  if (!email && !key) return { error: "" }; // belum diisi sama sekali — dianggap fitur nonaktif, bukan error
  if (!email || !key) return { error: `${!email ? "GOOGLE_SERVICE_ACCOUNT_EMAIL" : "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"} kosong padahal variabel Drive lain sudah diisi.` };
  return { email, key: normalizePrivateKey(key) };
}

export function resolveDriveConfig(env: Record<string, string | undefined>): DriveConfig {
  const creds = readCredentials(env);
  const rootFolderId = val(env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
  if ("error" in creds) {
    if (creds.error === "" && !rootFolderId) return { ok: false, problem: null }; // nonaktif: belum dikonfigurasi, ini kondisi normal
    return { ok: false, problem: creds.error || "GOOGLE_DRIVE_ROOT_FOLDER_ID kosong padahal kredensial service account sudah diisi." };
  }
  if (!rootFolderId) return { ok: false, problem: "GOOGLE_DRIVE_ROOT_FOLDER_ID belum diisi (ID folder 'Drive A' di Google Drive)." };
  if (!/^[\w-]{10,}$/.test(rootFolderId)) return { ok: false, problem: "GOOGLE_DRIVE_ROOT_FOLDER_ID tidak terlihat seperti ID folder Google Drive yang valid." };
  return { ok: true, serviceAccountEmail: creds.email, privateKeyPem: creds.key, rootFolderId, sharedDriveId: val(env.GOOGLE_DRIVE_SHARED_DRIVE_ID) ?? null };
}

/** Fitur Drive aktif untuk upload baru (konfigurasi lengkap). Dipakai tanpa perlu I/O. */
export function isDriveEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return resolveDriveConfig(env).ok;
}
