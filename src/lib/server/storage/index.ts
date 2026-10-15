import "server-only";
import { resolveStorageConfig } from "@/lib/server/storage/config";
import { LocalStorage } from "@/lib/server/storage/local";
import { SupabaseStorage } from "@/lib/server/storage/supabase";

export interface FileStorage {
  readonly name: string;
  put(path: string, data: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<ReadableStream<Uint8Array> | null>;
  remove(paths: string[]): Promise<void>;
}

let instance: FileStorage | undefined;

/** Konfigurasi penyimpanan tidak lengkap/tidak valid. Pesan hanya menyebut nama variabel (aman untuk log). */
export class StorageNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageNotConfiguredError";
  }
}

/**
 * Pilih penyimpanan berkas:
 * - STORAGE_DRIVER=supabase (default jika SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY tersedia): bucket privat.
 * - STORAGE_DRIVER=local: folder di server (LOCAL_STORAGE_DIR), untuk pengembangan/self-host.
 */
export function storage(): FileStorage {
  if (instance) return instance;
  const cfg = resolveStorageConfig(process.env);
  if (!cfg.ok) throw new StorageNotConfiguredError(cfg.problem);
  instance = cfg.driver === "supabase" ? new SupabaseStorage(cfg.url, cfg.key, cfg.bucket) : new LocalStorage(cfg.dir);
  return instance;
}

/** Path penyimpanan aman: hanya UUID + ekstensi yang sudah divalidasi — nama asli tidak dipakai. */
export function buildStoragePath(orderId: string, fileId: string, ext: string) {
  return `orders/${orderId}/${fileId}.${ext}`;
}
