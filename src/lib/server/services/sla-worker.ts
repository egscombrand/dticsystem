import "server-only";
import { sql } from "@/lib/server/db";
import { closeOrderBySla } from "@/lib/server/repositories/orders";

/**
 * Worker pemeriksaan deadline SLA di dalam proses server (dimulai dari instrumentation.ts, pola yang sama
 * dengan telegram-worker.ts) — berjalan persisten tanpa bergantung pada browser pengguna yang terbuka.
 * Query di sini hanya mencari KANDIDAT (longgar, aman dibaca tanpa kunci); ketepatan & idempotensi akhir
 * ada di closeOrderBySla (kunci baris + periksa ulang syarat di dalam transaksi).
 * Nonaktifkan dengan SLA_WORKER=off (mis. jika scheduler eksternal memanggil mekanisme lain).
 */
const GLOBAL_KEY = "__dticSlaWorker";

/**
 * Kandidat: status pekerjaan SIAPA PUN (apa pun statusnya) selama belum selesai/dibatalkan DAN belum pernah
 * ditutup karena SLA (sla_closed_at masih null) — status pekerjaan itu sendiri TIDAK PERNAH dijadikan syarat
 * di sini, SENGAJA, karena SLA adalah dimensi terpisah dari status pekerjaan (lihat closeOrderBySla).
 */
async function dueOrderIds(limit: number): Promise<string[]> {
  const rows = await sql()<{ id: string }[]>`
    select id from orders
    where stage_deadline_at is not null
      and stage_deadline_at < now()
      and sla_closed_at is null
      and deadline_agreement_status = 'agreed'
      and status not in ('completed', 'cancelled')
    order by stage_deadline_at
    limit ${limit}`;
  return rows.map((r) => r.id);
}

/** Satu putaran pemeriksaan: menutup semua order yang kandidatnya ditemukan. Mengembalikan jumlah yang BENAR-BENAR ditutup. */
export async function runSlaSweep(batchSize = 50): Promise<number> {
  const ids = await dueOrderIds(batchSize);
  let closed = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const r = await closeOrderBySla(id);
      if (r.closed) closed++;
    } catch (error) {
      failed++;
      console.error(`[sla-worker] gagal menutup order ${id}`, error instanceof Error ? error.message : error);
    }
  }
  console.info(`[sla-worker] putaran ${new Date().toISOString()}: ${ids.length} kandidat lewat SLA, ${closed} ditutup, ${failed} gagal`);
  return closed;
}

export function startSlaWorker(env: Record<string, string | undefined> = process.env): void {
  if (env.SLA_WORKER === "off") {
    console.info("[sla-worker] nonaktif (SLA_WORKER=off)");
    return;
  }
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[GLOBAL_KEY]) return; // hot reload / register dipanggil ulang
  const intervalMs = Math.max(1000, Number(env.SLA_WORKER_INTERVAL_MS ?? 60_000) || 60_000);
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // satu putaran berjalan dalam satu waktu di proses ini
    running = true;
    try {
      await runSlaSweep();
    } catch (error) {
      console.error("[sla-worker] putaran gagal", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  g[GLOBAL_KEY] = timer;
  console.info(`[sla-worker] berjalan setiap ${intervalMs} ms`);
}
