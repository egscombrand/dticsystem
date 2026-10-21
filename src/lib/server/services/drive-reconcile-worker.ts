import "server-only";
import { reconcileAllOrdersDriveMetadata } from "@/lib/server/repositories/drive-sync";
import { updateDriveReconcileWorkerState } from "@/lib/server/services/drive-reconcile-worker-state";

/**
 * Worker rekonsiliasi arsip Drive MENYELURUH, berjalan di dalam proses server (dimulai dari
 * instrumentation.ts) — pola yang sama dengan src/lib/server/services/telegram-worker.ts. Pemeriksaan per
 * order (saat halaman detail dibuka) tetap berjalan terpisah; worker ini menambahkan pemeriksaan harian
 * yang mencakup SELURUH order, termasuk yang halamannya tidak pernah dibuka lagi.
 * Nonaktifkan dengan DRIVE_RECONCILE_WORKER=off.
 */
const GLOBAL_KEY = "__dticDriveReconcileWorker";
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startDriveReconcileWorker(env: Record<string, string | undefined> = process.env): void {
  if (env.DRIVE_RECONCILE_WORKER === "off") {
    console.info("[drive-reconcile-worker] nonaktif (DRIVE_RECONCILE_WORKER=off)");
    return;
  }
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[GLOBAL_KEY]) return; // hot reload / register dipanggil ulang
  const intervalMs = Math.max(60_000, Number(env.DRIVE_RECONCILE_INTERVAL_MS ?? DEFAULT_INTERVAL_MS) || DEFAULT_INTERVAL_MS);
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // satu siklus berjalan dalam satu waktu di proses ini
    running = true;
    try {
      const result = await reconcileAllOrdersDriveMetadata();
      updateDriveReconcileWorkerState({ lastTickAt: new Date().toISOString(), lastResult: result, lastError: null });
      if (result.failed > 0 || result.partial > 0) {
        console.warn(`[drive-reconcile-worker] ${result.failed} gagal, ${result.partial} sebagian berhasil dari ${result.ordersChecked} order diperiksa`);
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : "unknown";
      updateDriveReconcileWorkerState({ lastTickAt: new Date().toISOString(), lastError: name });
      console.error("[drive-reconcile-worker] siklus gagal", name);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  g[GLOBAL_KEY] = timer;
  updateDriveReconcileWorkerState({ enabled: true, startedAt: new Date().toISOString() });
  console.info(`[drive-reconcile-worker] berjalan setiap ${intervalMs} ms`);
}
