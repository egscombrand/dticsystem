import { describe, expect, it } from "vitest";
import { resolveStorageConfig } from "@/lib/server/storage/config";

const KEY = "service-role-key-uji";
const URL_OK = "https://abcdefghijklmnopqrst.supabase.co";

describe("konfigurasi penyimpanan berkas", () => {
  it("supabase lengkap → driver supabase; bucket default", () => {
    const cfg = resolveStorageConfig({ STORAGE_DRIVER: "supabase", NEXT_PUBLIC_SUPABASE_URL: URL_OK, SUPABASE_SERVICE_ROLE_KEY: KEY });
    expect(cfg).toMatchObject({ ok: true, driver: "supabase", url: URL_OK, bucket: "order-attachments" });
  });
  it("key kosong (baris kosong di .env.local) → galat yang menyebut nama variabel, bukan nilainya", () => {
    const cfg = resolveStorageConfig({ STORAGE_DRIVER: "supabase", SUPABASE_URL: URL_OK, SUPABASE_SERVICE_ROLE_KEY: "" });
    expect(cfg.ok).toBe(false);
    if (!cfg.ok) {
      expect(cfg.problem).toMatch(/SUPABASE_SERVICE_ROLE_KEY kosong/);
      expect(cfg.problem).not.toContain(URL_OK);
    }
  });
  it("SUPABASE_URL kosong jatuh ke NEXT_PUBLIC_SUPABASE_URL", () => {
    const cfg = resolveStorageConfig({ STORAGE_DRIVER: "supabase", SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: URL_OK, SUPABASE_SERVICE_ROLE_KEY: KEY });
    expect(cfg).toMatchObject({ ok: true, url: URL_OK });
  });
  it("URL tidak valid atau bukan https ditolak", () => {
    expect(resolveStorageConfig({ STORAGE_DRIVER: "supabase", SUPABASE_URL: "bukan url", SUPABASE_SERVICE_ROLE_KEY: KEY }).ok).toBe(false);
    expect(resolveStorageConfig({ STORAGE_DRIVER: "supabase", SUPABASE_URL: "http://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY }).ok).toBe(false);
  });
  it("tanpa STORAGE_DRIVER: local bila supabase tidak lengkap; driver asing ditolak", () => {
    expect(resolveStorageConfig({})).toMatchObject({ ok: true, driver: "local", dir: ".data/uploads" });
    expect(resolveStorageConfig({ STORAGE_DRIVER: "s3" }).ok).toBe(false);
  });
});
