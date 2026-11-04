import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DriveNotConfiguredError, driveClient } from "@/lib/server/drive";
import { AppError } from "@/lib/server/errors";
import { storage } from "@/lib/server/storage";

/**
 * Pratinjau PowerPoint (PPT/PPTX) = konversi sisi server ke PDF memakai LibreOffice (`soffice`), lalu ditampilkan
 * dengan viewer PDF yang sama (satu slide = satu halaman). OPSIONAL: bila LibreOffice tidak terpasang atau
 * konversi gagal, endpoint menjawab 501/422 dengan pesan jelas dan UI menampilkan unduhan + referensi manual —
 * tidak pernah menampilkan pratinjau palsu. Konversi berjalan satu per satu (antrean) dan dibatasi waktu.
 */
const TIMEOUT_MS = 90_000;
const MAX_BYTES = 40 * 1024 * 1024;
const CACHE_MAX = 6;

let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Buffer>();

function run(cmd: string, args: string[]): Promise<{ code: number | null; missing: boolean; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = "";
    let done = false;
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    const finish = (r: { code: number | null; missing: boolean }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ...r, stderr });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, missing: false });
    }, TIMEOUT_MS);
    child.stderr.on("data", (d) => (stderr += String(d).slice(0, 2000)));
    child.on("error", (e: NodeJS.ErrnoException) => finish({ code: null, missing: e.code === "ENOENT" }));
    child.on("close", (code) => finish({ code, missing: false }));
  });
}

export async function convertPresentationToPdf(cacheKey: string, bytes: Uint8Array, ext: string): Promise<Buffer> {
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  if (bytes.byteLength > MAX_BYTES) throw new AppError("File presentasi terlalu besar untuk dipratinjau. Unduh file-nya.", 422);
  const job = queue.then(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dtic-pptx-"));
    try {
      const input = path.join(dir, `deck.${ext === "ppt" ? "ppt" : "pptx"}`);
      await writeFile(input, bytes);
      const r = await run(process.env.SOFFICE_PATH || "soffice", [
        `-env:UserInstallation=file://${path.join(dir, "profile")}`,
        "--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir", dir, input,
      ]);
      if (r.missing) throw new AppError("Pratinjau PowerPoint memerlukan LibreOffice di server dan belum tersedia. Unduh file-nya atau gunakan referensi manual.", 501);
      let pdf: Buffer;
      try {
        pdf = await readFile(path.join(dir, "deck.pdf"));
      } catch {
        throw new AppError("Presentasi tidak dapat dikonversi untuk pratinjau. Unduh file-nya atau gunakan referensi manual.", 422);
      }
      if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new AppError("Hasil konversi tidak valid.", 422);
      return pdf;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
  queue = job.catch(() => undefined);
  const pdf = (await job) as Buffer;
  cache.set(cacheKey, pdf);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return pdf;
}

/** Byte berkas lampiran (Drive atau penyimpanan lokal) — pemanggil sudah memeriksa hak akses. */
export async function readAttachmentBytes(a: { drive_file_id: string | null; storage_path: string | null }): Promise<Uint8Array> {
  let body: BodyInit | null = null;
  try {
    body = a.drive_file_id ? ((await (await driveClient()).downloadFile(a.drive_file_id)) as BodyInit) : a.storage_path ? ((await storage().get(a.storage_path)) as BodyInit) : null;
  } catch (error) {
    if (error instanceof DriveNotConfiguredError) throw new AppError("Berkas sedang tidak dapat diakses. Coba lagi nanti.", 503);
    throw error;
  }
  if (!body) throw new AppError("Berkas tidak ditemukan di penyimpanan.", 404);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export const PDF_RESPONSE_HEADERS = {
  "Content-Type": "application/pdf",
  "Content-Disposition": 'inline; filename="pratinjau.pdf"',
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  "Cache-Control": "private, no-store",
} as const;
