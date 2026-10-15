import "server-only";

/** Detak worker antrean Telegram (di memori proses server). Dipakai untuk diagnosis di halaman Integrasi. */
export type WorkerState = {
  /** false bila TELEGRAM_WORKER=off atau worker belum dimulai di proses ini. */
  enabled: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  lastProcessed: number;
  lastRerouted: number;
  lastError: string | null;
};

const KEY = "__dticTelegramWorkerState";
const EMPTY: WorkerState = { enabled: false, startedAt: null, lastTickAt: null, lastProcessed: 0, lastRerouted: 0, lastError: null };

export function workerState(): WorkerState {
  return ((globalThis as unknown as Record<string, unknown>)[KEY] as WorkerState | undefined) ?? EMPTY;
}

export function updateWorkerState(patch: Partial<WorkerState>): void {
  (globalThis as unknown as Record<string, unknown>)[KEY] = { ...workerState(), ...patch };
}
