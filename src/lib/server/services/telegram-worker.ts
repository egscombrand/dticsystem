import "server-only";
import { reviveStaleFailedOutbox } from "@/lib/server/repositories/notifications";
import { processDueOutbox } from "@/lib/server/services/telegram";
import { processFeedbackNotifications } from "@/lib/server/services/feedback-notify";
import { updateWorkerState } from "@/lib/server/services/telegram-worker-state";

/**
 * Worker pengiriman Telegram di dalam proses server (dimulai dari instrumentation.ts). Antrean di database adalah
 * sumber kebenaran: setelah restart, baris yang tertunda tetap jatuh tempo dan diproses tick berikutnya.
 * Nonaktifkan dengan TELEGRAM_WORKER=off (mis. jika scheduler eksternal memanggil endpoint tick).
 */
const GLOBAL_KEY = "__dticTelegramWorker";
/** Baris gagal-permanen (galat sementara) yang lebih tua dari ini dipulihkan sekali — lihat reviveStaleFailedOutbox.
 *  Dapat diubah lewat env (mis. pengujian E2E mempercepat cooldown ini). */
const REVIVE_COOLDOWN_MINUTES_DEFAULT = 30;
/** Jaring pengaman di atas tidak perlu diperiksa tiap tick (2 detik) — cukup jarang agar hemat, tetap sering
 *  dibanding cooldown-nya sendiri sehingga baris yang layak dipulihkan tidak menunggu lama setelah jatuh tempo. */
const REVIVE_CHECK_INTERVAL_MS_DEFAULT = 5 * 60 * 1000;

export function startTelegramWorker(env: Record<string, string | undefined> = process.env): void {
  if (env.TELEGRAM_WORKER === "off") {
    console.info("[telegram-worker] nonaktif (TELEGRAM_WORKER=off); antrean diproses lewat endpoint tick");
    return;
  }
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[GLOBAL_KEY]) return; // hot reload / register dipanggil ulang
  const intervalMs = Math.max(500, Number(env.TELEGRAM_WORKER_INTERVAL_MS ?? 2000) || 2000);
  const reviveCooldownRaw = Number(env.TELEGRAM_REVIVE_COOLDOWN_MINUTES ?? REVIVE_COOLDOWN_MINUTES_DEFAULT);
  const reviveCooldownMinutes = Number.isFinite(reviveCooldownRaw) && reviveCooldownRaw >= 0 ? reviveCooldownRaw : REVIVE_COOLDOWN_MINUTES_DEFAULT;
  const reviveCheckIntervalMs = Math.max(1000, Number(env.TELEGRAM_REVIVE_CHECK_INTERVAL_MS ?? REVIVE_CHECK_INTERVAL_MS_DEFAULT) || REVIVE_CHECK_INTERVAL_MS_DEFAULT);
  let running = false;
  let lastReviveCheckAt = 0;
  const timer = setInterval(async () => {
    if (running) return; // satu tick berjalan dalam satu waktu di proses ini
    running = true;
    try {
      if (Date.now() - lastReviveCheckAt >= reviveCheckIntervalMs) {
        lastReviveCheckAt = Date.now();
        const revived = await reviveStaleFailedOutbox(reviveCooldownMinutes);
        if (revived > 0) console.info(`[telegram-worker] ${revived} notifikasi gagal-permanen (galat sementara, > ${reviveCooldownMinutes} menit) dipulihkan untuk satu percobaan tambahan`);
      }
      const processed = await processDueOutbox(10);
      // Antrean notifikasi tiket Bantuan & Masukan diproses DI TICK YANG SAMA — bukan worker terpisah
      // (lihat processFeedbackNotifications: antrean & tujuan sendirinya murni terpisah dari order).
      await processFeedbackNotifications(10).catch((error) => console.error("[telegram-worker] tiket feedback gagal", error instanceof Error ? error.name : "unknown"));
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
