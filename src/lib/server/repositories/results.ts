import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { DriveApiError, ensureResultCategoryFolder, moveResultFileToFolder, uploadResultToDrive } from "@/lib/server/drive";
import { driveResultFileName, type DriveSyncStatus, type ResultCategory } from "@/lib/drive";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError, pgErrorCode } from "@/lib/server/errors";
import { isDriveActiveForUploads } from "@/lib/server/repositories/drive-settings";
import { primaryAssigneeName } from "@/lib/server/repositories/orders";
import { getExtension } from "@/lib/files";
import { buildStoragePath, storage } from "@/lib/server/storage";

export type ResultFile = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  uploaderName: string | null;
  uploadedBy: string | null;
  /** null = tersimpan di storage lokal/Supabase (perilaku lama, tidak berubah). */
  driveSyncStatus: DriveSyncStatus | null;
  driveSyncError: string | null;
};

export async function listResultFiles(orderId: string): Promise<ResultFile[]> {
  const rows = await sql()<{
    id: string; file_name: string; mime_type: string; file_size: number; created_at: Date; full_name: string | null; uploaded_by: string | null;
    sync_status: DriveSyncStatus | null; sync_error: string | null;
  }[]>`
    select a.id, a.file_name, a.mime_type, a.file_size, a.created_at, u.full_name, a.uploaded_by, a.sync_status, a.sync_error
    from order_attachments a left join app_users u on u.id = a.uploaded_by
    where a.order_id = ${orderId} and a.kind = 'result'
    order by a.created_at desc, a.file_name`;
  return rows.map((r) => ({
    id: r.id, fileName: r.file_name, mimeType: r.mime_type, fileSize: Number(r.file_size), uploadedAt: r.created_at.toISOString(),
    uploaderName: r.full_name, uploadedBy: r.uploaded_by, driveSyncStatus: r.sync_status, driveSyncError: r.sync_error,
  }));
}

const toFile = (r: { id: string; file_name: string; mime_type: string; file_size: number }) => ({ id: r.id, fileName: r.file_name, mimeType: r.mime_type, fileSize: Number(r.file_size) });
type SavedFile = ReturnType<typeof toFile> & { driveSyncStatus: DriveSyncStatus | null };

/** Sewa klaim sinkronisasi Drive (pola sama dengan LEASE_SECONDS worker Telegram): proses yang macet lebih dari ini boleh diklaim ulang. */
const SYNC_LEASE_SECONDS = 120;

type ClaimedRow = {
  id: string;
  order_id: string;
  order_number: string;
  requester_name: string;
  design_type: string;
  title: string;
  created_at: Date;
  file_name: string;
  mime_type: string;
  upload_key: string;
};

const ORDER_CONTEXT_COLUMNS = "o.id as order_id, o.order_number, o.requester_name, o.design_type, o.title, o.created_at";

/**
 * Waktu pengajuan QC PERTAMA kali untuk order ini, atau null bila belum pernah diajukan — acuan tanggal
 * folder arsip Drive (lihat driveResultFolderPath di src/lib/drive.ts). Didefinisikan di sini (bukan impor
 * dari src/lib/server/repositories/qc.ts) karena qc.ts sendiri mengimpor dari modul ini (moveResultFilesToCategory,
 * assertResultFiles/Links) — menghindari impor sirkular antar dua modul.
 */
async function firstQcSubmittedAt(orderId: string): Promise<Date | null> {
  const [r] = await sql()<{ created_at: Date }[]>`
    select created_at from order_workflow_events where order_id = ${orderId} and kind = 'qc_submitted' order by created_at asc limit 1`;
  return r?.created_at ?? null;
}

/**
 * Klaim baris `id` untuk (coba) disinkronkan ke Drive, atau null bila proses lain yang sedang mengklaim
 * (lihat SYNC_LEASE_SECONDS). 'failed' = percobaan sebelumnya sudah PASTI selesai (gagal) — boleh diklaim
 * ulang kapan saja, retry manual tidak perlu menunggu. 'pending' MUNGKIN masih aktif diproses proses lain
 * (klik ganda, retry bersamaan): sewa singkat (pola sama dengan claimOutboxById untuk Telegram) mencegah
 * dua proses memanggil Drive untuk file yang sama; baris yang benar-benar terputus (proses mati) tetap
 * bisa diklaim ulang setelah sewa habis.
 */
async function claimRowForSync(db: ReturnType<typeof sql>, id: string): Promise<ClaimedRow | null> {
  const claimed = await db<ClaimedRow[]>`
    update order_attachments oa set sync_status = 'pending', sync_error = null, sync_locked_at = now()
    from orders o
    where oa.id = ${id} and o.id = oa.order_id
      and (oa.sync_status = 'failed' or (oa.sync_status = 'pending' and (oa.sync_locked_at is null or oa.sync_locked_at < now() - make_interval(secs => ${SYNC_LEASE_SECONDS}))))
    returning oa.id, ${db.unsafe(ORDER_CONTEXT_COLUMNS)}, oa.file_name, oa.mime_type, oa.upload_key`;
  return claimed[0] ?? null;
}

/**
 * Jalankan upload ke Drive untuk satu baris `order_attachments` yang sudah ada (dibuat dengan
 * sync_status='pending' SEBELUM baris ini dipanggil — lihat saveResultFile). Tidak menahan transaksi
 * database selama memanggil Drive (pola yang sama dengan worker notifikasi Telegram: klaim singkat, proses
 * di luar transaksi, lalu simpan hasil). Idempoten: uploadKey dipakai sebagai kunci idempotensi di Drive,
 * jadi dipanggil ulang untuk baris 'pending'/'failed' yang sama tidak pernah menggandakan file di Drive.
 *
 * File BARU selalu masuk kategori "proses_pengerjaan" (draf) — baru dipindahkan ke Hasil Awal/Revisi/Final
 * saat benar-benar dirujuk oleh aksi alur QC yang sudah ada (lihat moveResultFilesToCategory, dipanggil
 * dari src/lib/server/repositories/qc.ts), karena pada saat unggah sistem belum tahu file ini akan dipakai
 * untuk apa — itu baru diketahui saat PIC menekan "Ajukan QC".
 */
async function syncRowToDrive(row: ClaimedRow, bytes: Uint8Array): Promise<SavedFile> {
  try {
    // Destructure defensif: count(*) selalu mengembalikan tepat satu baris secara normal, TAPI di bawah
    // tekanan konkurensi berat (koneksi tunggal diperebutkan) terbukti bisa resolve kosong — lebih baik
    // version jatuh ke 1 daripada melempar "Cannot read properties of undefined" yang tidak informatif.
    const priorCount = (await sql()<{ c: number }[]>`select count(*)::int as c from order_attachments where order_id = ${row.order_id} and kind = 'result'`)[0]?.c ?? 0;
    const version = Math.max(1, priorCount);
    const picName = await primaryAssigneeName(row.order_id);
    // Sebelum pengajuan QC pertama, belum ada "tanggal penyerahan" yang pasti — folder draf memakai waktu
    // unggah ini sebagai nilai sementara. Setelah pernah diajukan (mis. unggahan baru untuk revisi), pakai
    // tanggal pengajuan pertama yang sudah tercatat, supaya tetap konsisten dengan folder Hasil Awal/Revisi.
    const submittedAt = (await firstQcSubmittedAt(row.order_id)) ?? new Date();
    const folderId = await ensureResultCategoryFolder({
      picName,
      submittedAt,
      requesterName: row.requester_name,
      orderNumber: row.order_number,
      orderTitle: row.title,
      category: "proses_pengerjaan",
    });
    const driveFileName = driveResultFileName({
      orderNumber: row.order_number,
      requesterName: row.requester_name,
      picName,
      designType: row.design_type,
      category: "proses_pengerjaan",
      version,
      uploadedAt: new Date(),
      ext: getExtension(row.file_name) || "bin",
    });
    const { file } = await uploadResultToDrive({ folderId, fileName: driveFileName, mimeType: row.mime_type, bytes, idempotencyKey: row.upload_key });
    const [updated] = await sql()<{ id: string; file_name: string; mime_type: string; file_size: number }[]>`
      update order_attachments
      set drive_file_id = ${file.id}, drive_folder_id = ${folderId}, drive_web_view_link = ${file.webViewLink}, file_size = ${bytes.byteLength},
          sync_status = 'synced', sync_error = null, synced_at = now()
      where id = ${row.id}
      returning id, file_name, mime_type, file_size`;
    return { ...toFile(updated), driveSyncStatus: "synced" };
  } catch (error) {
    const message = error instanceof DriveApiError ? error.message : "Tidak dapat menghubungi Google Drive.";
    console.error("[results] sinkronisasi Drive gagal:", error instanceof Error ? error.message : "error");
    await sql()`update order_attachments set sync_status = 'failed', sync_error = ${message} where id = ${row.id}`;
    throw new AppError(`File belum tersimpan di Google Drive: ${message} Coba lagi.`, 503);
  }
}

/**
 * Pindahkan file hasil yang sudah tersinkron ke kategori folder lain saat statusnya berubah lewat aksi alur
 * QC yang SUDAH ADA — dipanggil dari src/lib/server/repositories/qc.ts setelah submit_qc/approve_qc/complete
 * berhasil tersimpan. Kegagalan di sini TIDAK membatalkan aksi QC yang sudah tersimpan (Drive adalah sistem
 * kedua yang terpisah dari database — lihat catatan "tidak ada transaksi atomik lintas layanan" di bawah):
 * file tetap bisa diakses di folder lama, hanya belum terorganisasi ulang; dicatat ke log untuk investigasi.
 */
export async function moveResultFilesToCategory(orderId: string, fileIds: string[], category: ResultCategory, revisionNumber?: number): Promise<void> {
  if (fileIds.length === 0) return;
  if (!(await isDriveActiveForUploads())) return;
  const db = sql();
  const rows = await db<{ id: string; drive_file_id: string | null; drive_folder_id: string | null; file_name: string; mime_type: string; version: number }[]>`
    select id, drive_file_id, drive_folder_id, file_name, mime_type,
           row_number() over (order by created_at) as version
    from order_attachments
    where order_id = ${orderId} and kind = 'result' and sync_status in ('synced', 'pending', 'failed')`;
  const driveRows = rows.filter((r): r is typeof r & { drive_file_id: string; drive_folder_id: string } => fileIds.includes(r.id) && Boolean(r.drive_file_id && r.drive_folder_id));
  if (driveRows.length === 0) return;
  try {
    const [order] = await db<{ order_number: string; requester_name: string; design_type: string; title: string }[]>`
      select order_number, requester_name, design_type, title from orders where id = ${orderId}`;
    if (!order) return;
    const picName = await primaryAssigneeName(orderId);
    // Pada titik ini pengajuan QC yang memicu pemindahan ini sudah tercatat di transaksi yang sama
    // (applyWorkflowAction menyimpan peristiwa qc_submitted sebelum memanggil fungsi ini), jadi
    // firstQcSubmittedAt selalu mengembalikan nilai — tidak pernah null di jalur ini.
    const submittedAt = (await firstQcSubmittedAt(orderId)) ?? new Date();
    const toFolderId = await ensureResultCategoryFolder({ picName, submittedAt, requesterName: order.requester_name, orderNumber: order.order_number, orderTitle: order.title, category });
    const now = new Date();
    for (const r of driveRows) {
      const newName = driveResultFileName({
        orderNumber: order.order_number,
        requesterName: order.requester_name,
        picName,
        designType: order.design_type,
        category,
        revisionNumber,
        version: r.version,
        uploadedAt: now,
        ext: getExtension(r.file_name) || "bin",
      });
      if (r.drive_folder_id === toFolderId) continue;
      await moveResultFileToFolder(r.drive_file_id, r.drive_folder_id, toFolderId, newName);
      await db`update order_attachments set drive_folder_id = ${toFolderId} where id = ${r.id}`;
    }
  } catch (error) {
    console.error("[results] pindah folder kategori Drive gagal:", error instanceof Error ? error.message : "error");
  }
}

/**
 * Simpan satu file hasil. uploadKey dari klien (per file) membuat upload ulang setelah timeout tidak
 * menggandakan file: bila kunci sudah tersimpan DAN sudah selesai (local/Supabase, atau Drive berstatus
 * 'synced'), baris yang ada dikembalikan dan berkas baru tidak ditulis. Bila kunci sudah ada tapi Drive
 * masih 'pending'/'failed' (percobaan sebelumnya terputus/timeout/gagal), baris yang sama dicoba ulang
 * alih-alih membuat baris baru — dan karena Drive sendiri dicari dulu lewat idempotencyKey sebelum
 * mengunggah, percobaan ulang ini tidak pernah menggandakan file walau Drive ternyata SUDAH menerima file
 * pada percobaan sebelumnya (kegagalan hanya terjadi saat menyimpan metadata).
 */
export async function saveResultFile(
  orderId: string,
  file: { uploadKey: string; fileName: string; ext: string; mimeType: string; bytes: Uint8Array },
  actorUserId: string,
): Promise<{ file: SavedFile; duplicate: boolean }> {
  const db = sql();
  const find = async () =>
    (await db<{ id: string; file_name: string; mime_type: string; file_size: number; sync_status: DriveSyncStatus | null; order_number: string | null; upload_key: string }[]>`
      select oa.id, oa.file_name, oa.mime_type, oa.file_size, oa.sync_status, o.order_number, oa.upload_key
      from order_attachments oa join orders o on o.id = oa.order_id
      where oa.order_id = ${orderId} and oa.upload_key = ${file.uploadKey}`)[0];
  const existing = await find();
  if (existing && (existing.sync_status === null || existing.sync_status === "synced")) {
    return { file: { ...toFile(existing), driveSyncStatus: existing.sync_status }, duplicate: true };
  }

  if (!(await isDriveActiveForUploads())) {
    // Driver lama (local/Supabase), tidak berubah sama sekali dari sebelum fitur Drive ada. Berlaku juga
    // bila env sudah terisi tapi Super Admin belum menekan "Aktifkan Integrasi" di dashboard.

    const storagePath = buildStoragePath(orderId, randomUUID(), file.ext);
    await storage().put(storagePath, file.bytes, file.mimeType);
    try {
      const [row] = await db<{ id: string; file_name: string; mime_type: string; file_size: number }[]>`
        insert into order_attachments (order_id, file_name, storage_path, mime_type, file_size, kind, uploaded_by, upload_key)
        values (${orderId}, ${file.fileName}, ${storagePath}, ${file.mimeType}, ${file.bytes.byteLength}, 'result', ${actorUserId}, ${file.uploadKey})
        returning id, file_name, mime_type, file_size`;
      return { file: { ...toFile(row), driveSyncStatus: null }, duplicate: false };
    } catch (error) {
      await storage().remove([storagePath]).catch(() => {});
      if (pgErrorCode(error) === "23505") {
        const again = await find();
        if (again) return { file: { ...toFile(again), driveSyncStatus: again.sync_status }, duplicate: true };
      }
      throw error;
    }
  }

  // Driver Drive: klaim/buat baris 'pending' singkat (tanpa menahan transaksi selama memanggil Drive),
  // lalu unggah, lalu simpan hasil. "jangan menyatakan upload berhasil sebelum file tersimpan": status
  // hanya menjadi 'synced' setelah Drive benar-benar mengonfirmasi dan metadata tersimpan.
  let row: ClaimedRow;
  if (existing) {
    const claimed = await claimRowForSync(db, existing.id);
    if (!claimed) {
      // Permintaan lain sudah mengklaim/menyelesaikan baris ini tepat sekarang; laporkan keadaan terkini.
      const again = await find();
      return { file: { ...toFile(again!), driveSyncStatus: again!.sync_status }, duplicate: true };
    }
    row = claimed;
  } else {
    const [order] = await db<{ order_number: string; requester_name: string; design_type: string; title: string; created_at: Date }[]>`
      select order_number, requester_name, design_type, title, created_at from orders where id = ${orderId}`;
    if (!order) throw new NotFoundError("Order tidak ditemukan.");
    try {
      const [inserted] = await db<{ id: string; file_name: string; mime_type: string; upload_key: string }[]>`
        insert into order_attachments (order_id, file_name, mime_type, file_size, kind, uploaded_by, upload_key, sync_status, sync_locked_at)
        values (${orderId}, ${file.fileName}, ${file.mimeType}, ${file.bytes.byteLength}, 'result', ${actorUserId}, ${file.uploadKey}, 'pending', now())
        returning id, file_name, mime_type, upload_key`;
      row = { ...inserted, order_id: orderId, order_number: order.order_number, requester_name: order.requester_name, design_type: order.design_type, title: order.title, created_at: order.created_at };
    } catch (error) {
      if (pgErrorCode(error) === "23505") {
        // Permintaan paralel dengan kunci sama membuat baris lebih dulu; proses baris itu, bukan membuat baru.
        const again = await find();
        if (again) return saveResultFile(orderId, file, actorUserId);
      }
      throw error;
    }
  }

  return { file: await syncRowToDrive(row, file.bytes), duplicate: false };
}

/**
 * Coba lagi sinkronisasi Drive untuk file yang gagal/terputus sebelumnya. Byte file TIDAK disimpan di
 * server antar-permintaan (percobaan pertama yang gagal tidak meninggalkan apa pun untuk dipakai ulang),
 * sehingga retry dari daftar "File hasil" (bukan dari dialog unggah yang masih punya berkasnya di memori
 * peramban) perlu pengguna memilih berkas itu lagi — tombol Coba Lagi di UI meminta ini secara eksplisit.
 * Idempoten lewat kunci upload_key BARIS INI (bukan kunci baru), sama seperti alur unggah pertama.
 */
export async function retryResultSync(orderId: string, fileId: string, bytes: Uint8Array): Promise<{ file: SavedFile; duplicate: boolean }> {
  if (!(await isDriveActiveForUploads())) throw new AppError("Integrasi Google Drive sedang nonaktif.", 503);
  const db = sql();
  const [current] = await db<{ sync_status: DriveSyncStatus | null; uploaded_by: string | null }[]>`
    select sync_status, uploaded_by from order_attachments where id = ${fileId} and order_id = ${orderId} and kind = 'result'`;
  if (!current) throw new NotFoundError("File hasil tidak ditemukan.");
  if (current.sync_status === "synced") return { file: { ...(await listOneForRetry(orderId, fileId)), driveSyncStatus: "synced" }, duplicate: true };
  if (current.sync_status === null) throw new AppError("File ini tidak memakai Google Drive.", 422);

  const claimed = await claimRowForSync(db, fileId);
  if (!claimed) {
    const again = await listOneForRetry(orderId, fileId);
    return { file: { ...again, driveSyncStatus: "pending" }, duplicate: true };
  }
  return { file: await syncRowToDrive(claimed, bytes), duplicate: false };
}

async function listOneForRetry(orderId: string, fileId: string) {
  const [row] = await sql()<{ id: string; file_name: string; mime_type: string; file_size: number }[]>`
    select id, file_name, mime_type, file_size from order_attachments where id = ${fileId} and order_id = ${orderId}`;
  return toFile(row);
}

/** Hapus file hasil yang masih draf (belum dirujuk pengajuan/pengiriman/penyelesaian). Riwayat lain tidak disentuh. */
export async function deleteDraftResult(orderId: string, fileId: string, actor: { userId: string; isSuperAdmin: boolean }) {
  const path = await sql().begin(async (tx) => {
    const [f] = await tx<{ storage_path: string | null; uploaded_by: string | null }[]>`
      select storage_path, uploaded_by from order_attachments where id = ${fileId} and order_id = ${orderId} and kind = 'result' for update`;
    if (!f) throw new NotFoundError("File hasil tidak ditemukan.");
    if (!actor.isSuperAdmin && f.uploaded_by !== actor.userId) throw new AppError("Hanya pengunggah yang dapat menghapus file draf ini.", 403);
    const used = await tx`select 1 from order_workflow_events where order_id = ${orderId} and detail->'resultFileIds' ? ${fileId} limit 1`;
    if (used.length > 0) throw new AppError("File ini sudah diserahkan dan tercatat di riwayat, sehingga tidak dapat dihapus.", 409);
    await tx`delete from order_attachments where id = ${fileId}`;
    return f.storage_path;
  });
  // Baris berbasis Drive (storage_path null) sengaja TIDAK dihapus dari Drive: file hasil adalah dokumen
  // kerja, bukan sesuatu yang aman dihapus otomatis hanya karena baris draf di DB dihapus.
  if (path) await storage().remove([path]).catch((e) => console.error("[results] hapus berkas", e instanceof Error ? e.message : "error"));
}

export type ResultLink = { id: string; url: string; title: string; description: string | null; createdByName: string | null; createdBy: string | null; createdAt: string };

export async function listResultLinks(orderId: string): Promise<ResultLink[]> {
  const rows = await sql()<{ id: string; url: string; title: string; description: string | null; created_by: string | null; full_name: string | null; created_at: Date }[]>`
    select l.id, l.url, l.title, l.description, l.created_by, u.full_name, l.created_at
    from order_result_links l left join app_users u on u.id = l.created_by
    where l.order_id = ${orderId}
    order by l.created_at desc`;
  return rows.map((r) => ({ id: r.id, url: r.url, title: r.title, description: r.description, createdBy: r.created_by, createdByName: r.full_name, createdAt: r.created_at.toISOString() }));
}

export async function addResultLink(orderId: string, input: { url: string; title: string; description: string | null }, actorUserId: string): Promise<ResultLink> {
  const [row] = await sql()<{ id: string; url: string; title: string; description: string | null; created_at: Date }[]>`
    insert into order_result_links (order_id, url, title, description, created_by)
    values (${orderId}, ${input.url}, ${input.title}, ${input.description}, ${actorUserId})
    returning id, url, title, description, created_at`;
  const [actor] = await sql()<{ full_name: string }[]>`select full_name from app_users where id = ${actorUserId}`;
  return { id: row.id, url: row.url, title: row.title, description: row.description, createdBy: actorUserId, createdByName: actor?.full_name ?? null, createdAt: row.created_at.toISOString() };
}

/** Hapus link hasil — hanya pembuatnya atau Super Admin, dan hanya selama belum dirujuk oleh riwayat pengajuan (sama seperti file draf). */
export async function deleteResultLink(orderId: string, linkId: string, actor: { userId: string; isSuperAdmin: boolean }): Promise<void> {
  const [l] = await sql()<{ created_by: string | null }[]>`select created_by from order_result_links where id = ${linkId} and order_id = ${orderId}`;
  if (!l) throw new NotFoundError("Link hasil tidak ditemukan.");
  if (!actor.isSuperAdmin && l.created_by !== actor.userId) throw new AppError("Hanya yang menambahkan link ini yang dapat menghapusnya.", 403);
  const used = await sql()`select 1 from order_workflow_events where order_id = ${orderId} and detail->'resultLinkIds' ? ${linkId} limit 1`;
  if (used.length > 0) throw new AppError("Link ini sudah diserahkan dan tercatat di riwayat, sehingga tidak dapat dihapus.", 409);
  await sql()`delete from order_result_links where id = ${linkId}`;
}

/** Pastikan semua ID adalah link hasil milik order ini (dipakai di dalam transaksi aksi, sama seperti assertResultFiles). */
export async function assertResultLinks(tx: postgres.TransactionSql, orderId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const rows = await tx<{ id: string }[]>`select id from order_result_links where order_id = ${orderId} and id in ${tx(unique)}`;
  if (rows.length !== unique.length) throw new AppError("Sebagian link hasil tidak ditemukan pada pekerjaan ini. Muat ulang halaman lalu coba lagi.", 422, { resultLinkIds: "Link hasil tidak valid." });
}

/** Pastikan semua ID adalah file hasil milik order ini (dipakai di dalam transaksi aksi). */
export async function assertResultFiles(tx: postgres.TransactionSql, orderId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const rows = await tx<{ id: string }[]>`select id from order_attachments where order_id = ${orderId} and kind = 'result' and id in ${tx(unique)}`;
  if (rows.length !== unique.length) throw new AppError("Sebagian file hasil tidak ditemukan pada pekerjaan ini. Muat ulang halaman lalu coba lagi.", 422, { resultFileIds: "File hasil tidak valid." });
}
