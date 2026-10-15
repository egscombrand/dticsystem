/**
 * Pemilihan & validasi konfigurasi penyimpanan berkas (MURNI: tanpa "server-only", bisa diuji unit).
 * Nilai kosong ("") dianggap TIDAK diisi. Pesan galat hanya menyebut nama variabel, tidak pernah nilainya.
 */
export type StorageConfig =
  | { ok: true; driver: "supabase"; url: string; key: string; bucket: string }
  | { ok: true; driver: "local"; dir: string }
  | { ok: false; problem: string };

const val = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function resolveStorageConfig(env: Record<string, string | undefined>): StorageConfig {
  // URL proyek bukan rahasia; boleh memakai NEXT_PUBLIC_SUPABASE_URL yang sudah ada.
  const url = val(env.SUPABASE_URL) ?? val(env.NEXT_PUBLIC_SUPABASE_URL);
  const key = val(env.SUPABASE_SERVICE_ROLE_KEY);
  const driver = val(env.STORAGE_DRIVER) ?? (url && key ? "supabase" : "local");
  if (driver === "local") return { ok: true, driver, dir: val(env.LOCAL_STORAGE_DIR) ?? ".data/uploads" };
  if (driver !== "supabase") return { ok: false, problem: `STORAGE_DRIVER tidak dikenal (harus "supabase" atau "local").` };
  const missing = [!url && "SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean);
  if (missing.length) {
    return { ok: false, problem: `STORAGE_DRIVER=supabase tetapi ${missing.join(" dan ")} kosong. Periksa juga baris kosong di .env.local yang menimpa .env.` };
  }
  let parsed: URL;
  try {
    parsed = new URL(url!);
  } catch {
    return { ok: false, problem: "URL Supabase tidak valid." };
  }
  if (parsed.protocol !== "https:") return { ok: false, problem: "URL Supabase harus https." };
  return { ok: true, driver, url: url!, key: key!, bucket: val(env.SUPABASE_STORAGE_BUCKET) ?? "order-attachments" };
}
