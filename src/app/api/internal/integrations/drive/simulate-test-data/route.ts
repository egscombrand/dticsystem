import { authorize } from "@/lib/server/auth";
import { buildSimulationPlan, runSimulation } from "@/lib/server/drive/simulate";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { listMemberOptions } from "@/lib/server/repositories/master-data";
import { isDriveActiveForUploads } from "@/lib/server/repositories/drive-settings";
import { AppError } from "@/lib/server/errors";

/**
 * Data simulasi (UAT) di dalam folder PIC yang SUDAH ADA di Drive A. Selalu `dryRun: true` oleh default —
 * HANYA mengembalikan rencana (folder/file apa yang AKAN dibuat atau dipakai ulang) tanpa menyentuh Drive
 * sama sekali. Mengubah Drive sungguhan WAJIB body `{ "apply": true }` secara eksplisit. Hanya Super Admin.
 * Tidak pernah menyentuh data produksi (request/order) — lihat src/lib/server/drive/simulate.ts.
 */
export async function POST(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    if (!(await isDriveActiveForUploads())) {
      throw new AppError("Integrasi Google Drive belum diaktifkan.", 422);
    }
    const body = (await readJson(request).catch(() => ({}))) as { apply?: boolean; onlyMemberId?: string };
    const apply = body.apply === true;

    const members = (await listMemberOptions()).filter((m) => m.isActive && (!body.onlyMemberId || m.id === body.onlyMemberId));
    const plan = await buildSimulationPlan(members.map((m) => ({ id: m.id, name: m.name })));

    if (!apply) {
      return json({
        dryRun: true,
        testRunId: plan.testRunId,
        dateSegment: plan.dateSegment,
        picFoldersDetected: plan.items.length,
        ambiguousDriveFolders: plan.ambiguousDriveFolders,
        plan: plan.items.map((i) => ({
          memberName: i.memberName,
          path: [`DTICSystemNexus/${i.memberName}`, ...i.uatFolderPath].join("/"),
          filesToCreate: i.filesToCreate,
        })),
      });
    }

    const result = await runSimulation(plan);
    return json({
      dryRun: false,
      testRunId: result.testRunId,
      picFoldersProcessed: result.items.length,
      ambiguousDriveFolders: result.ambiguousDriveFolders,
      items: result.items,
    });
  } catch (error) {
    return errorResponse(error, "POST integrations/drive/simulate-test-data");
  }
}
