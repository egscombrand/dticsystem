import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { FileStorage } from "@/lib/server/storage";

/** Penyimpanan lokal di luar folder public — berkas hanya bisa diakses lewat route internal. */
export class LocalStorage implements FileStorage {
  readonly name = "local";
  private readonly root: string;

  constructor(dir: string) {
    this.root = path.resolve(dir);
  }

  private resolve(p: string) {
    const full = path.resolve(this.root, p);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Path penyimpanan tidak valid.");
    return full;
  }

  async put(p: string, data: Uint8Array) {
    const full = this.resolve(p);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: "wx" });
  }

  async get(p: string) {
    const full = this.resolve(p);
    try {
      const s = await stat(full);
      if (!s.isFile()) return null;
    } catch {
      return null;
    }
    return Readable.toWeb(createReadStream(full)) as ReadableStream<Uint8Array>;
  }

  async remove(paths: string[]) {
    await Promise.all(paths.map((p) => rm(this.resolve(p), { force: true })));
    // Bersihkan folder order yang kosong
    const dirs = new Set(paths.map((p) => path.dirname(this.resolve(p))));
    await Promise.all([...dirs].map((d) => rmdir(d).catch(() => {})));
  }
}
