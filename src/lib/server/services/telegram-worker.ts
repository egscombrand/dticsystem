import "server-only";
import { processDueOutbox } from "@/lib/server/services/telegram";
import { updateWorkerState } from "@/lib/server/services/telegram-worker-state";

/**
 * Worker pengiriman Telegram di dalam proses server (dimulai dari instrumentation.ts). Antrean di database adalah
 * sumber kebenaran: setelah restart, baris yang tertunda tetap jatuh tempo dan diproses tick berikutnya.
 * Nonaktifkan dengan TELEGRAM_WORKER=off (mis. jika scheduler eksternal memanggil endpoint tick).
 */
const GLOBAL_KEY = "__dticTelegramWorker";

export function startTelegramWorker(env: Record<string, string | undefined> = process.env): void {
  if (env.TELEGRAM_WORKER === "off") {
    console.info("[telegram-worker] nonaktif (TELEGRAM_WORKER=off); antrean diproses lewat endpoint tick");
    return;
  }
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[GLOBAL_KEY]) return; // hot reload / register dipanggil ulang
  const intervalMs = Math.max(500, Number(env.TELEGRAM_WORKER_INTERVAL_MS ?? 2000) || 2000);
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // satu tick berjalan dalam satu waktu di proses ini
    running = true;
    try {
      const processed = await processDueOutbox(10);
      updateWorkerState({ lastTickAt: new Date().toISOString(), lastProcessed: processed, lastError: null });
    } catch (error) {
      const name = error instanceof Error ? error.name : "unknown";
      updateWorkerState({ lastTickAt: new Date().toISOString(), lastError: name });
      console.error("[telegram-worker] tick gagal", name);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  g[GLOBAL_KEY] = timer;
  updateWorkerState({ enabled: true, startedAt: new Date().toISOString() });
  console.info(`[telegram-worker] berjalan setiap ${intervalMs} ms`);
}
