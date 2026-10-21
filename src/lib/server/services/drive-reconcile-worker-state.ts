import "server-only";

/** Detak worker rekonsiliasi arsip Drive harian (di memori proses server). Dipakai untuk diagnosis di halaman Integrasi. */
export type DriveReconcileWorkerState = {
  /** false bila DRIVE_RECONCILE_WORKER=off atau worker belum dimulai di proses ini. */
  enabled: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  lastResult: { ordersChecked: number; succeeded: number; partial: number; failed: number } | null;
  lastError: string | null;
};

const KEY = "__dticDriveReconcileWorkerState";
const EMPTY: DriveReconcileWorkerState = { enabled: false, startedAt: null, lastTickAt: null, lastResult: null, lastError: null };

export function driveReconcileWorkerState(): DriveReconcileWorkerState {
  return ((globalThis as unknown as Record<string, unknown>)[KEY] as DriveReconcileWorkerState | undefined) ?? EMPTY;
}

export function updateDriveReconcileWorkerState(patch: Partial<DriveReconcileWorkerState>): void {
  (globalThis as unknown as Record<string, unknown>)[KEY] = { ...driveReconcileWorkerState(), ...patch };
}
