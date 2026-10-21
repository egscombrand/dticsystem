import { authorize } from "@/lib/server/auth";
import { syncMemberFolders } from "@/lib/server/drive";
import { assertSameOrigin, errorResponse, json } from "@/lib/server/http";
import { listMemberOptions } from "@/lib/server/repositories/master-data";
import { isDriveActiveForUploads, recordMemberFolderSync, type MemberSyncSummary } from "@/lib/server/repositories/drive-settings";
import { AppError } from "@/lib/server/errors";

/**
 * Buat (atau temukan ulang) satu folder Drive A per anggota DTIC AKTIF, LANGSUNG di bawah folder akar —
 * tanpa folder perantara seperti "01_ANGGOTA_DTIC" (lihat syncMemberFolders di src/lib/server/drive/index.ts).
 * Idempoten: aman dijalankan berulang kali, tidak pernah menggandakan folder anggota yang sudah ada.
 * Hanya Super Admin. Membutuhkan integrasi Drive sudah diaktifkan (bukan hanya dikonfigurasi) — status ini
 * TERPISAH dari status "Uji Koneksi" dan status upload hasil pekerjaan (lihat drive-settings.ts).
 */
export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    if (!(await isDriveActiveForUploads())) {
      throw new AppError("Integrasi Google Drive belum diaktifkan. Jalankan Uji Koneksi dan Aktifkan integrasi terlebih dahulu.", 422);
    }
    const members = (await listMemberOptions()).filter((m) => m.isActive);
    const result = await syncMemberFolders(members.map((m) => ({ id: m.id, name: m.name })));
    const summary: MemberSyncSummary = {
      processed: result.items.length,
      created: result.createdCount,
      existing: result.existingCount,
      failed: result.failedCount,
      failedMembers: result.items
        .filter((item): item is { memberId: string; memberName: string; error: string } => "error" in item)
        .map((item) => ({ memberId: item.memberId, memberName: item.memberName, error: item.error })),
    };
    const state = await recordMemberFolderSync(summary, auth.session.userId);
    return json({ ok: summary.failed === 0, summary, state });
  } catch (error) {
    return errorResponse(error, "POST integrations/drive/sync-members");
  }
}
