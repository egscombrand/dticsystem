import type { Instrumentation } from "next";
import { diagnoseDbError } from "@/lib/server/db-diagnostics";

/** Worker notifikasi Telegram & rekonsiliasi arsip Drive berjalan di proses Node.js server (bukan di edge). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTelegramWorker } = await import("@/lib/server/services/telegram-worker");
    startTelegramWorker();
    const { startDriveReconcileWorker } = await import("@/lib/server/services/drive-reconcile-worker");
    startDriveReconcileWorker();
  }
}

/** Menambahkan petunjuk diagnosis ke log server untuk error database saat render halaman. */
export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  const hint = diagnoseDbError(error);
  if (hint) console.error(`[database] ${request.method} ${request.path}: ${hint}`);
};
