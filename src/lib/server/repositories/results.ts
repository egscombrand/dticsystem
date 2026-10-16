import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError, pgErrorCode } from "@/lib/server/errors";
import { buildStoragePath, storage } from "@/lib/server/storage";

export type ResultFile = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  uploaderName: string | null;
  uploadedBy: string | null;
};

export async function listResultFiles(orderId: string): Promise<ResultFile[]> {
  const rows = await sql()<{ id: string; file_name: string; mime_type: string; file_size: number; created_at: Date; full_name: string | null; uploaded_by: string | null }[]>`
    select a.id, a.file_name, a.mime_type, a.file_size, a.created_at, u.full_name, a.uploaded_by
    from order_attachments a left join app_users u on u.id = a.uploaded_by
    where a.order_id = ${orderId} and a.kind = 'result'
    order by a.created_at desc, a.file_name`;
  return rows.map((r) => ({ id: r.id, fileName: r.file_name, mimeType: r.mime_type, fileSize: Number(r.file_size), uploadedAt: r.created_at.toISOString(), uploaderName: r.full_name, uploadedBy: r.uploaded_by }));
}

const toFile = (r: { id: string; file_name: string; mime_type: string; file_size: number }) => ({ id: r.id, fileName: r.file_name, mimeType: r.mime_type, fileSize: Number(r.file_size) });

/**
 * Simpan satu file hasil. uploadKey dari klien (per file) membuat upload ulang setelah timeout tidak
 * menggandakan file: bila kunci sudah tersimpan, baris yang ada dikembalikan dan berkas baru tidak ditulis.
 */
export async function saveResultFile(
  orderId: string,
  file: { uploadKey: string; fileName: string; ext: string; mimeType: string; bytes: Uint8Array },
  actorUserId: string,
): Promise<{ file: ReturnType<typeof toFile>; duplicate: boolean }> {
  const db = sql();
  const find = async () =>
    (await db<{ id: string; file_name: string; mime_type: string; file_size: number }[]>`
      select id, file_name, mime_type, file_size from order_attachments where order_id = ${orderId} and upload_key = ${file.uploadKey}`)[0];
  const existing = await find();
  if (existing) return { file: toFile(existing), duplicate: true };

  const storagePath = buildStoragePath(orderId, randomUUID(), file.ext);
  await storage().put(storagePath, file.bytes, file.mimeType);
  try {
    const [row] = await db<{ id: string; file_name: string; mime_type: string; file_size: number }[]>`
      insert into order_attachments (order_id, file_name, storage_path, mime_type, file_size, kind, uploaded_by, upload_key)
      values (${orderId}, ${file.fileName}, ${storagePath}, ${file.mimeType}, ${file.bytes.byteLength}, 'result', ${actorUserId}, ${file.uploadKey})
      returning id, file_name, mime_type, file_size`;
    return { file: toFile(row), duplicate: false };
  } catch (error) {
    await storage().remove([storagePath]).catch(() => {});
    // Permintaan paralel dengan kunci sama: kembalikan yang sudah tersimpan.
    if (pgErrorCode(error) === "23505") {
      const again = await find();
      if (again) return { file: toFile(again), duplicate: true };
    }
    throw error;
  }
}

/** Hapus file hasil yang masih draf (belum dirujuk pengajuan/pengiriman/penyelesaian). Riwayat lain tidak disentuh. */
export async function deleteDraftResult(orderId: string, fileId: string, actor: { userId: string; isSuperAdmin: boolean }) {
  const path = await sql().begin(async (tx) => {
    const [f] = await tx<{ storage_path: string; uploaded_by: string | null }[]>`
      select storage_path, uploaded_by from order_attachments where id = ${fileId} and order_id = ${orderId} and kind = 'result' for update`;
    if (!f) throw new NotFoundError("File hasil tidak ditemukan.");
    if (!actor.isSuperAdmin && f.uploaded_by !== actor.userId) throw new AppError("Hanya pengunggah yang dapat menghapus file draf ini.", 403);
    const used = await tx`select 1 from order_workflow_events where order_id = ${orderId} and detail->'resultFileIds' ? ${fileId} limit 1`;
    if (used.length > 0) throw new AppError("File ini sudah diserahkan dan tercatat di riwayat, sehingga tidak dapat dihapus.", 409);
    await tx`delete from order_attachments where id = ${fileId}`;
    return f.storage_path;
  });
  await storage().remove([path]).catch((e) => console.error("[results] hapus berkas", e instanceof Error ? e.message : "error"));
}

/** Pastikan semua ID adalah file hasil milik order ini (dipakai di dalam transaksi aksi). */
export async function assertResultFiles(tx: postgres.TransactionSql, orderId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const rows = await tx<{ id: string }[]>`select id from order_attachments where order_id = ${orderId} and kind = 'result' and id in ${tx(unique)}`;
  if (rows.length !== unique.length) throw new AppError("Sebagian file hasil tidak ditemukan pada pekerjaan ini. Muat ulang halaman lalu coba lagi.", 422, { resultFileIds: "File hasil tidak valid." });
}
