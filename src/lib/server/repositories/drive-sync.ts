import "server-only";
import { sql } from "@/lib/server/db";
import { driveClient, isDriveEnabled } from "@/lib/server/drive";
import { findResultCategoryFolder } from "@/lib/server/drive/index";
import { isDriveActiveForUploads } from "@/lib/server/repositories/drive-settings";
import { primaryAssigneeName } from "@/lib/server/repositories/orders";
import { firstQcSubmittedAt } from "@/lib/server/repositories/qc";
import { ESCALATION_THRESHOLD, sendDriveEscalationAlert } from "@/lib/server/services/drive-escalation";
import { RESULT_CATEGORY_FOLDER, type ResultCategory } from "@/lib/drive";
import type { DriveFileMeta } from "@/lib/server/drive/client";
import { pgErrorCode } from "@/lib/server/errors";

const RESULT_CATEGORIES = Object.keys(RESULT_CATEGORY_FOLDER) as ResultCategory[];
/** Sinkronisasi ulang dalam jendela ini dilewati (dedupe) — tombol manual bisa memaksa lewat `force`. */
const DEDUPE_WINDOW_MS = 2 * 60 * 1000;
/** Sewa kunci sinkronisasi — baris dianggap bebas diklaim ulang bila locked_at kosong atau lebih tua dari ini. */
const LOCK_LEASE_MS = 30 * 1000;

export type OrderDriveSyncState = {
  lastSyncAt: string | null;
  lastSyncStatus: "success" | "partial" | "failed" | null;
  lastSyncMessage: string | null;
};

const isMissingTable = (error: unknown) => pgErrorCode(error) === "42P01";

export async function getOrderDriveSyncState(orderId: string): Promise<OrderDriveSyncState> {
  try {
    const rows = await sql()<{ last_sync_at: Date | null; last_sync_status: "success" | "partial" | "failed" | null; last_sync_message: string | null }[]>`
      select last_sync_at, last_sync_status, last_sync_message from order_drive_sync where order_id = ${orderId}`;
    const r = rows[0];
    if (!r) return { lastSyncAt: null, lastSyncStatus: null, lastSyncMessage: null };
    return { lastSyncAt: r.last_sync_at?.toISOString() ?? null, lastSyncStatus: r.last_sync_status, lastSyncMessage: r.last_sync_message };
  } catch (error) {
    if (isMissingTable(error)) return { lastSyncAt: null, lastSyncStatus: null, lastSyncMessage: null };
    throw error;
  }
}

export type SyncOrderResult = { skipped: true; reason: string } | { skipped: false; status: "success" | "partial" | "failed"; message: string; discovered: number; updated: number; missing: number; movedOut: number };

/**
 * Sinkronkan metadata Google Drive -> DB untuk SATU order (Fase 3). TIDAK PERNAH mengunggah ulang file,
 * TIDAK PERNAH membuat folder baru (findResultCategoryFolder hanya mencari) — murni membaca metadata Drive
 * dan memperbarui catatan database yang sudah ada / menambah catatan untuk file yang terbukti milik order
 * ini (ditemukan di salah satu folder kategori hasil order ini — lihat findResultCategoryFolder).
 *
 * Deduplikasi: dilewati (skipped) bila disinkronkan < 2 menit lalu dan bukan `force`, ATAU sedang dikunci
 * oleh proses lain (sewa 30 detik) — mencegah tombol ditekan berulang/auto-sync saat render ulang memicu
 * banyak panggilan Drive bersamaan untuk order yang sama.
 */
export async function syncOrderDriveMetadata(orderId: string, opts: { force?: boolean } = {}): Promise<SyncOrderResult> {
  if (!isDriveEnabled() || !(await isDriveActiveForUploads())) {
    return { skipped: true, reason: "Integrasi Google Drive tidak aktif." };
  }

  const db = sql();
  try {
    await db`insert into order_drive_sync (order_id) values (${orderId}) on conflict (order_id) do nothing`;
  } catch (error) {
    if (isMissingTable(error)) return { skipped: true, reason: "Tabel sinkronisasi belum tersedia (migration belum diterapkan)." };
    throw error;
  }

  // Klaim sewa secara ATOMIK (satu UPDATE...WHERE, pola sama dengan claimRowForSync di results.ts) —
  // mencegah dua permintaan bersamaan (klik ganda, auto-sync + tombol manual) lolos pemeriksaan bersama
  // lalu keduanya memanggil Drive untuk order yang sama.
  const leaseFreeSql = opts.force
    ? db`(oas.last_sync_locked_at is null or oas.last_sync_locked_at < now() - make_interval(secs => ${LOCK_LEASE_MS / 1000}))`
    : db`(oas.last_sync_locked_at is null or oas.last_sync_locked_at < now() - make_interval(secs => ${LOCK_LEASE_MS / 1000}))
         and (oas.last_sync_at is null or oas.last_sync_at < now() - make_interval(secs => ${DEDUPE_WINDOW_MS / 1000}))`;
  const [claimed] = await db<{ order_id: string }[]>`
    update order_drive_sync oas set last_sync_locked_at = now()
    where oas.order_id = ${orderId} and ${leaseFreeSql}
    returning oas.order_id`;
  if (!claimed) {
    const state = await getOrderDriveSyncState(orderId);
    const reason = state.lastSyncAt && Date.now() - new Date(state.lastSyncAt).getTime() < DEDUPE_WINDOW_MS ? "Baru saja disinkronkan." : "Sinkronisasi lain untuk order ini sedang berjalan.";
    return { skipped: true, reason };
  }

  try {
    const result = await doSync(orderId);
    await db`
      update order_drive_sync set last_sync_at = now(), last_sync_status = ${result.status}, last_sync_message = ${result.message}, last_sync_locked_at = null
      where order_id = ${orderId}`;
    await recordOutcomeAndMaybeEscalate(orderId, result.status);
    return { skipped: false, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sinkronisasi gagal.";
    // Sengaja TIDAK memperbarui last_sync_at pada kegagalan total (lihat instruksi: jangan memperbarui
    // waktu sukses hanya karena proses dimulai) — hanya status/pesan + lepas kunci.
    await db`update order_drive_sync set last_sync_status = 'failed', last_sync_message = ${message.slice(0, 500)}, last_sync_locked_at = null where order_id = ${orderId}`;
    await recordOutcomeAndMaybeEscalate(orderId, "failed");
    return { skipped: false, status: "failed", message, discovered: 0, updated: 0, missing: 0, movedOut: 0 };
  }
}

/**
 * Perbarui hitungan gagal/sebagian berturut-turut (Fase 7/eskalasi) & kirim peringatan sekali per
 * rangkaian kegagalan bila melewati ambang (lihat ESCALATION_THRESHOLD) — tidak pernah membatalkan hasil
 * sinkronisasi yang sudah tersimpan; kegagalan mengirim peringatan hanya dicatat ke log.
 */
async function recordOutcomeAndMaybeEscalate(orderId: string, status: "success" | "partial" | "failed"): Promise<void> {
  const db = sql();
  if (status === "success") {
    await db`update order_drive_sync set consecutive_fail_count = 0, escalated_at = null where order_id = ${orderId}`;
    return;
  }
  const [row] = await db<{ consecutive_fail_count: number; escalated_at: Date | null }[]>`
    update order_drive_sync set consecutive_fail_count = consecutive_fail_count + 1
    where order_id = ${orderId}
    returning consecutive_fail_count, escalated_at`;
  if (!row || row.escalated_at !== null || row.consecutive_fail_count < ESCALATION_THRESHOLD) return;
  const [order] = await db<{ order_number: string; title: string }[]>`select order_number, title from orders where id = ${orderId}`;
  if (!order) return;
  try {
    const sent = await sendDriveEscalationAlert(order.order_number, order.title, row.consecutive_fail_count);
    if (sent.ok) await db`update order_drive_sync set escalated_at = now() where order_id = ${orderId}`;
    else console.error(`[drive-sync] eskalasi ${order.order_number} tidak terkirim: ${sent.message}`);
  } catch (error) {
    console.error("[drive-sync] eskalasi gagal:", error instanceof Error ? error.message : "error");
  }
}

async function doSync(orderId: string): Promise<{ status: "success" | "partial" | "failed"; message: string; discovered: number; updated: number; missing: number; movedOut: number }> {
  const db = sql();
  const [order] = await db<{ order_number: string; requester_name: string; design_type: string; title: string; created_at: Date }[]>`
    select order_number, requester_name, design_type, title, created_at from orders where id = ${orderId}`;
  if (!order) return { status: "failed", message: "Order tidak ditemukan.", discovered: 0, updated: 0, missing: 0, movedOut: 0 };

  const picName = await primaryAssigneeName(orderId);
  const client = await driveClient();
  // Sama seperti syncRowToDrive: sebelum pengajuan QC pertama, folder draf (proses_pengerjaan) memakai
  // waktu unggah sebagai tanggal sementara (tidak bisa direkonstruksi persis di sini bila unggahan draf
  // terjadi lintas-hari sebelum pengajuan pertama — keterbatasan yang sudah ada, bukan regresi baru).
  // Setelah pernah diajukan, SEMUA kategori (termasuk draf untuk unggahan revisi berikutnya) konsisten
  // memakai tanggal pengajuan pertama ini.
  const submittedAt = (await firstQcSubmittedAt(orderId)) ?? order.created_at;

  // Folder kategori hasil order ini (hanya yang SUDAH ADA — findResultCategoryFolder tidak membuat apa pun).
  const categoryFolders: { category: ResultCategory; folderId: string }[] = [];
  let folderLookupFailed = 0;
  for (const category of RESULT_CATEGORIES) {
    try {
      const folderId = await findResultCategoryFolder({ picName, submittedAt, requesterName: order.requester_name, orderNumber: order.order_number, orderTitle: order.title, category });
      if (folderId) categoryFolders.push({ category, folderId });
    } catch {
      folderLookupFailed += 1;
    }
  }
  const knownFolderIds = new Set(categoryFolders.map((c) => c.folderId));

  const existingRows = await db<{ id: string; drive_file_id: string | null; file_name: string; drive_folder_id: string | null }[]>`
    select id, drive_file_id, file_name, drive_folder_id from order_attachments where order_id = ${orderId} and kind = 'result' and drive_file_id is not null`;

  let updated = 0;
  let missing = 0;
  let movedOut = 0;
  let perFileFailed = 0;

  // 1) Rekonsiliasi file yang SUDAH tercatat: masih ada? nama/folder berubah?
  for (const row of existingRows) {
    try {
      const meta = await client.getFileMetadata(row.drive_file_id!);
      if (!meta) {
        await db`update order_attachments set reconcile_status = 'missing', reconciled_at = now() where id = ${row.id}`;
        missing += 1;
        continue;
      }
      const parentId = meta.parents[0] ?? null;
      const stillInOrder = parentId !== null && knownFolderIds.has(parentId);
      const reconcileStatus = stillInOrder ? null : "moved_out";
      if (!stillInOrder) movedOut += 1;
      // meta.modifiedTime SEHARUSNYA selalu terisi dari Google (lihat dokumentasi field drive/v3) — tetap
      // dijaga agar satu nilai tak terduga (string kosong/tidak valid) tidak menggagalkan SELURUH baris
      // lewat timestamp tak valid yang ditolak database (bukan skenario mustahil untuk dijaga, murah untuk dicegah).
      const parsedModifiedTime = meta.modifiedTime ? new Date(meta.modifiedTime) : null;
      const modifiedTime = parsedModifiedTime && !Number.isNaN(parsedModifiedTime.getTime()) ? parsedModifiedTime : null;
      await db`
        update order_attachments set
          file_name = ${meta.name},
          drive_folder_id = ${stillInOrder ? parentId : row.drive_folder_id},
          drive_modified_time = ${modifiedTime},
          reconcile_status = ${reconcileStatus},
          reconciled_at = now()
        where id = ${row.id}`;
      updated += 1;
    } catch {
      perFileFailed += 1;
    }
  }

  // 2) Temukan file BARU di folder kategori order ini yang belum tercatat (dibuktikan lewat folder ID).
  const knownFileIds = new Set(existingRows.map((r) => r.drive_file_id));
  let discovered = 0;
  for (const { folderId } of categoryFolders) {
    let files: DriveFileMeta[];
    try {
      files = await client.listFiles(folderId);
    } catch {
      perFileFailed += 1;
      continue;
    }
    for (const f of files) {
      if (knownFileIds.has(f.id)) continue;
      // Dicegah menggandakan lintas-order: folder deterministik (PIC/Tahun/Tanggal/Pemohon/Kategori) BISA
      // dipakai bersama >1 order (PIC & tanggal & pemohon sama) — file yang sudah tercatat di order LAIN
      // tidak boleh ikut dicatat lagi di sini.
      const [already] = await db<{ id: string }[]>`select id from order_attachments where drive_file_id = ${f.id} limit 1`;
      if (already) continue;
      await db`
        insert into order_attachments (order_id, file_name, mime_type, file_size, kind, drive_file_id, drive_folder_id, drive_modified_time, sync_status, synced_at, reconciled_at)
        values (${orderId}, ${f.name}, ${f.mimeType || "application/octet-stream"}, ${Math.max(f.size, 1)}, 'result', ${f.id}, ${folderId}, ${new Date(f.modifiedTime)}, 'synced', now(), now())`;
      knownFileIds.add(f.id);
      discovered += 1;
    }
  }

  const totalFailed = perFileFailed + folderLookupFailed;
  const status = totalFailed === 0 ? "success" : updated + discovered > 0 || existingRows.length === 0 ? "partial" : "failed";
  const parts = [`${updated} diperbarui`, `${discovered} ditemukan baru`, `${missing} tidak ditemukan`, `${movedOut} pindah folder`];
  if (totalFailed > 0) parts.push(`${totalFailed} gagal dibaca`);
  return { status, message: parts.join(", "), discovered, updated, missing, movedOut };
}

export type ReconcileAllResult = {
  ordersChecked: number;
  succeeded: number;
  partial: number;
  failed: number;
  /** Order yang berstatus 'partial'/'failed' pada siklus ini — dipakai eskalasi (lihat drive-reconcile-worker.ts). */
  problemOrderIds: string[];
};

/**
 * Pemeriksaan arsip MENYELURUH (Fase 7): sinkronkan metadata Drive untuk SETIAP order yang pernah punya
 * file hasil berbasis Drive, satu per satu (TIDAK paralel — menghormati batas laju Google yang sudah
 * ditangani withRetry di client Drive; panggilan paralel ke banyak order sekaligus berisiko memicu 429
 * massal). Dipanggil oleh worker harian (drive-reconcile-worker.ts), bukan dari permintaan pengguna.
 */
export async function reconcileAllOrdersDriveMetadata(): Promise<ReconcileAllResult> {
  if (!isDriveEnabled() || !(await isDriveActiveForUploads())) {
    return { ordersChecked: 0, succeeded: 0, partial: 0, failed: 0, problemOrderIds: [] };
  }
  const db = sql();
  const orderIds = (
    await db<{ order_id: string }[]>`select distinct order_id from order_attachments where kind = 'result' and drive_file_id is not null`
  ).map((r) => r.order_id);

  let succeeded = 0;
  let partial = 0;
  let failed = 0;
  const problemOrderIds: string[] = [];
  for (const orderId of orderIds) {
    const result = await syncOrderDriveMetadata(orderId, { force: true });
    if (result.skipped) continue; // integrasi nonaktif — seluruh siklus tidak relevan, dibiarkan apa adanya
    if (result.status === "success") succeeded += 1;
    else {
      if (result.status === "partial") partial += 1;
      else failed += 1;
      problemOrderIds.push(orderId);
    }
  }
  return { ordersChecked: orderIds.length, succeeded, partial, failed, problemOrderIds };
}
