import "server-only";
import type { FileStorage } from "@/lib/server/storage";

/** Supabase Storage via REST, memakai service-role key yang HANYA ada di server. */
export class SupabaseStorage implements FileStorage {
  readonly name = "supabase";
  private readonly base: string;

  constructor(
    url: string,
    private readonly key: string,
    private readonly bucket: string,
  ) {
    this.base = `${url.replace(/\/+$/, "")}/storage/v1`;
  }

  private headers(extra?: Record<string, string>) {
    return { Authorization: `Bearer ${this.key}`, apikey: this.key, ...extra };
  }

  private objectUrl(path: string) {
    return `${this.base}/object/${encodeURIComponent(this.bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  async put(path: string, data: Uint8Array, contentType: string) {
    const res = await fetch(this.objectUrl(path), {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "x-upsert": "false", "Cache-Control": "no-store" }),
      body: data as BodyInit,
    });
    if (!res.ok) throw new Error(`Upload storage gagal (HTTP ${res.status}).`);
  }

  async get(path: string) {
    const res = await fetch(this.objectUrl(path), { headers: this.headers(), cache: "no-store" });
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok || !res.body) throw new Error(`Unduh storage gagal (HTTP ${res.status}).`);
    return res.body;
  }

  async remove(paths: string[]) {
    if (paths.length === 0) return;
    const res = await fetch(`${this.base}/object/${encodeURIComponent(this.bucket)}`, {
      method: "DELETE",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: paths }),
    });
    if (!res.ok) throw new Error(`Hapus storage gagal (HTTP ${res.status}).`);
  }
}
