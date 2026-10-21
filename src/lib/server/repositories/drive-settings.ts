import "server-only";
import { isDriveEnabled } from "@/lib/server/drive";
import { sql } from "@/lib/server/db";
import { AppError, pgErrorCode } from "@/lib/server/errors";

/**
 * Status aktivasi integrasi Drive A, TERPISAH dari konfigurasi env (src/lib/server/drive/config.ts).
 * Kredensial/folder hanya diatur lewat environment server (tidak pernah disimpan di tabel ini — lihat
 * migration supabase/migrations/20261019000000_drive_admin_settings.sql); tabel ini hanya menyimpan
 * KEPUTUSAN admin (aktif/tidak) dan hasil pengujian terakhir, agar mengisi env var saja TIDAK langsung
 * membuat upload PIC memakai Drive — admin harus menguji koneksi dan mengaktifkannya secara sengaja.
 */
export type MemberSyncSummary = { processed: number; created: number; existing: number; failed: number; failedMembers: { memberId: string; memberName: string; error: string }[] };

export type DriveIntegrationState = {
  enabled: boolean;
  enabledAt: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  /** TERPISAH dari status koneksi (lastTest*) dan status upload hasil pekerjaan — lihat migration 20261020000000. */
  lastMemberSyncAt: string | null;
  lastMemberSyncOk: boolean | null;
  lastMemberSyncSummary: MemberSyncSummary | null;
  /** false bila migration tabel ini belum diterapkan — integrasi dianggap aman/nonaktif, bukan error. */
  tableReady: boolean;
};

const DEFAULT_STATE: DriveIntegrationState = {
  enabled: false,
  enabledAt: null,
  lastTestAt: null,
  lastTestOk: null,
  lastTestMessage: null,
  lastMemberSyncAt: null,
  lastMemberSyncOk: null,
  lastMemberSyncSummary: null,
  tableReady: false,
};

const isMissingTable = (error: unknown) => pgErrorCode(error) === "42P01";
const isMissingColumn = (error: unknown) => pgErrorCode(error) === "42703";

export async function getDriveIntegrationState(): Promise<DriveIntegrationState> {
  try {
    const rows = await sql()<
      {
        enabled: boolean;
        enabled_at: Date | null;
        last_test_at: Date | null;
        last_test_ok: boolean | null;
        last_test_message: string | null;
        last_member_sync_at: Date | null;
        last_member_sync_ok: boolean | null;
        last_member_sync_summary: MemberSyncSummary | null;
      }[]
    >`select enabled, enabled_at, last_test_at, last_test_ok, last_test_message, last_member_sync_at, last_member_sync_ok, last_member_sync_summary from drive_integration_settings where id = 1`;
    const r = rows[0];
    if (!r) return { ...DEFAULT_STATE, tableReady: true };
    return {
      enabled: r.enabled,
      enabledAt: r.enabled_at?.toISOString() ?? null,
      lastTestAt: r.last_test_at?.toISOString() ?? null,
      lastTestOk: r.last_test_ok,
      lastTestMessage: r.last_test_message,
      lastMemberSyncAt: r.last_member_sync_at?.toISOString() ?? null,
      lastMemberSyncOk: r.last_member_sync_ok,
      lastMemberSyncSummary: r.last_member_sync_summary ?? null,
      tableReady: true,
    };
  } catch (error) {
    if (isMissingTable(error)) return DEFAULT_STATE;
    // Tabel sudah ada (migration 20261019 diterapkan) tapi kolom sinkronisasi folder anggota
    // (migration 20261020) belum — tabel TETAP dianggap siap (test/enable/disable tidak boleh ikut
    // rusak), hanya status sinkronisasi folder anggota yang dianggap "belum pernah dijalankan".
    if (isMissingColumn(error)) {
      const rows = await sql()<
        { enabled: boolean; enabled_at: Date | null; last_test_at: Date | null; last_test_ok: boolean | null; last_test_message: string | null }[]
      >`select enabled, enabled_at, last_test_at, last_test_ok, last_test_message from drive_integration_settings where id = 1`;
      const r = rows[0];
      if (!r) return { ...DEFAULT_STATE, tableReady: true };
      return {
        enabled: r.enabled,
        enabledAt: r.enabled_at?.toISOString() ?? null,
        lastTestAt: r.last_test_at?.toISOString() ?? null,
        lastTestOk: r.last_test_ok,
        lastTestMessage: r.last_test_message,
        lastMemberSyncAt: null,
        lastMemberSyncOk: null,
        lastMemberSyncSummary: null,
        tableReady: true,
      };
    }
    throw error;
  }
}

/** Dipakai jalur upload hasil (saveResultFile/retryResultSync): konfigurasi valid DAN diaktifkan sengaja. */
export async function isDriveActiveForUploads(): Promise<boolean> {
  if (!isDriveEnabled()) return false;
  return (await getDriveIntegrationState()).enabled;
}

/** Simpan hasil "Uji Koneksi". Gagal menyimpan (migration belum ada) tidak menggagalkan pengujian itu sendiri. */
export async function recordDriveTest(ok: boolean, message: string, actorId: string): Promise<DriveIntegrationState> {
  const safeMessage = message.slice(0, 300);
  try {
    await sql().begin(async (tx) => {
      await tx`
        insert into drive_integration_settings (id, last_test_at, last_test_ok, last_test_message)
        values (1, now(), ${ok}, ${safeMessage})
        on conflict (id) do update set last_test_at = now(), last_test_ok = ${ok}, last_test_message = ${safeMessage}`;
      await tx`insert into auth_audit_log (actor_user_id, action, detail) values (${actorId}, 'drive_connection_tested', ${tx.json({ ok })})`;
    });
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  return getDriveIntegrationState();
}

/**
 * Simpan hasil "Sinkronkan Folder Anggota" (TERPISAH dari status Uji Koneksi dan status upload hasil
 * pekerjaan — lihat komentar DriveIntegrationState). Gagal menyimpan (migration belum ada) tidak
 * menggagalkan sinkronisasi yang sudah benar-benar berjalan terhadap Google Drive.
 */
export async function recordMemberFolderSync(summary: MemberSyncSummary, actorId: string): Promise<DriveIntegrationState> {
  const ok = summary.failed === 0;
  try {
    await sql().begin(async (tx) => {
      await tx`
        insert into drive_integration_settings (id, last_member_sync_at, last_member_sync_ok, last_member_sync_summary)
        values (1, now(), ${ok}, ${tx.json(summary)})
        on conflict (id) do update set last_member_sync_at = now(), last_member_sync_ok = ${ok}, last_member_sync_summary = ${tx.json(summary)}`;
      await tx`insert into auth_audit_log (actor_user_id, action, detail) values (${actorId}, 'drive_member_folders_synced', ${tx.json({ processed: summary.processed, created: summary.created, existing: summary.existing, failed: summary.failed })})`;
    });
  } catch (error) {
    if (!isMissingTable(error) && !isMissingColumn(error)) throw error;
  }
  return getDriveIntegrationState();
}

/**
 * Aktifkan/nonaktifkan integrasi. Mengaktifkan WAJIB: konfigurasi env valid, tabel pengaturan sudah ada
 * (migration diterapkan), dan pengujian koneksi TERAKHIR berhasil — menolak jika salah satu belum terpenuhi,
 * sesuai permintaan "jangan aktifkan hanya karena tombol ditekan jika prasyarat belum terpenuhi".
 */
export async function setDriveEnabled(enabled: boolean, actorId: string): Promise<DriveIntegrationState> {
  if (enabled) {
    if (!isDriveEnabled()) throw new AppError("Konfigurasi Google Drive belum lengkap. Lengkapi environment variable server terlebih dahulu.", 422);
    const state = await getDriveIntegrationState();
    if (!state.tableReady) throw new AppError("Tabel pengaturan integrasi Drive belum tersedia. Terapkan migration database terlebih dahulu.", 503);
    if (state.lastTestOk !== true) throw new AppError("Jalankan Uji Koneksi dan pastikan berhasil sebelum mengaktifkan integrasi.", 422);
  }
  try {
    await sql().begin(async (tx) => {
      await tx`
        insert into drive_integration_settings (id, enabled, enabled_at, enabled_by)
        values (1, ${enabled}, ${enabled ? new Date() : null}, ${enabled ? actorId : null})
        on conflict (id) do update set
          enabled = excluded.enabled,
          enabled_at = case when excluded.enabled then now() else drive_integration_settings.enabled_at end,
          enabled_by = case when excluded.enabled then excluded.enabled_by else drive_integration_settings.enabled_by end`;
      await tx`insert into auth_audit_log (actor_user_id, action, detail) values (${actorId}, ${enabled ? "drive_integration_enabled" : "drive_integration_disabled"}, ${tx.json({})})`;
    });
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    throw new AppError("Tabel pengaturan integrasi Drive belum tersedia. Terapkan migration database terlebih dahulu.", 503);
  }
  return getDriveIntegrationState();
}

/** Jumlah file hasil yang gagal disinkronkan ke Drive, atau null bila kolom/tabel terkait belum ada. */
export async function countFailedDriveSyncs(): Promise<number | null> {
  try {
    const rows = await sql()<{ count: string }[]>`select count(*)::text as count from order_attachments where sync_status = 'failed'`;
    return Number(rows[0]?.count ?? 0);
  } catch (error) {
    if (pgErrorCode(error) === "42703" || isMissingTable(error)) return null;
    throw error;
  }
}

export type FailedDriveSync = { orderId: string; orderNumber: string; fileName: string; syncError: string | null; updatedAt: string };

/** Daftar singkat file yang gagal disinkronkan (untuk "Lihat Log Sinkronisasi"). */
export async function listFailedDriveSyncs(limit = 20): Promise<FailedDriveSync[]> {
  try {
    const rows = await sql()<{ order_id: string; order_number: string; file_name: string; sync_error: string | null; sync_locked_at: Date | null; created_at: Date }[]>`
      select a.order_id, o.order_number, a.file_name, a.sync_error, a.sync_locked_at, a.created_at
      from order_attachments a join orders o on o.id = a.order_id
      where a.sync_status = 'failed'
      order by coalesce(a.sync_locked_at, a.created_at) desc
      limit ${limit}`;
    return rows.map((r) => ({
      orderId: r.order_id,
      orderNumber: r.order_number,
      fileName: r.file_name,
      syncError: r.sync_error,
      updatedAt: (r.sync_locked_at ?? r.created_at).toISOString(),
    }));
  } catch (error) {
    if (pgErrorCode(error) === "42703" || isMissingTable(error)) return [];
    throw error;
  }
}
