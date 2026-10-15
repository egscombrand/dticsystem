/**
 * Klasifikasi hasil panggilan Telegram Bot API (murni, tanpa jaringan). Memisahkan dengan tegas:
 *  - network  : fetch melempar exception sebelum ada respons HTTP (DNS, koneksi, TLS, timeout).
 *  - invalid  : ada respons HTTP tetapi bukan JSON Telegram yang valid.
 *  - telegram : Telegram menjawab dengan { ok:false, error_code, description }.
 * Status HTTP 0 tidak pernah dianggap kode Telegram.
 */

export type ApiOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; kind: "network"; reason: NetworkReason; code: string | null }
  | { ok: false; kind: "invalid"; httpStatus: number }
  | { ok: false; kind: "telegram"; httpStatus: number; errorCode: number; description: string; retryAfterSeconds: number | null };

export type NetworkReason = "timeout" | "dns" | "connection" | "tls" | "unknown";

const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,39}$/;

/** Ambil penyebab dari exception fetch (undici menaruh kode koneksi di `cause`). Hanya nama & kode, tanpa pesan/URL. */
export function classifyNetworkError(error: unknown): { reason: NetworkReason; code: string | null } {
  const e = (error ?? {}) as { name?: unknown; code?: unknown; cause?: { code?: unknown; name?: unknown } };
  const rawCode = typeof e.cause?.code === "string" ? e.cause.code : typeof e.code === "string" ? e.code : null;
  const code = rawCode && SAFE_CODE.test(rawCode) ? rawCode : null;
  const name = typeof e.name === "string" ? e.name : "";
  if (name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return { reason: "timeout", code };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { reason: "dns", code };
  if (code && (code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL") || code.includes("CERT") || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE")) {
    return { reason: "tls", code };
  }
  if (code && ["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CLOSED"].includes(code)) {
    return { reason: "connection", code };
  }
  return { reason: "unknown", code };
}

const NETWORK_TEXT: Record<NetworkReason, string> = {
  timeout: "Telegram tidak merespons tepat waktu. Koneksi ke Telegram tidak selesai sebelum batas waktu. Coba lagi beberapa saat.",
  dns: "Nama host Telegram tidak dapat diselesaikan dari server (DNS). Periksa konfigurasi DNS atau jaringan server.",
  connection: "Koneksi ke Telegram terputus atau ditolak sebelum respons diterima. Periksa jaringan atau proksi server.",
  tls: "Koneksi aman (TLS) ke Telegram gagal. Periksa sertifikat atau inspeksi TLS di jaringan server.",
  unknown: "Tidak dapat terhubung ke Telegram. Tidak ada respons yang diterima. Lihat log server untuk penyebabnya.",
};

/** Pesan untuk pengguna. Tidak pernah menampilkan status HTTP 0 atau kata "menolak" tanpa jawaban Telegram. */
export function describeApiFailure(outcome: Exclude<ApiOutcome<unknown>, { ok: true }>): string {
  if (outcome.kind === "network") return NETWORK_TEXT[outcome.reason];
  if (outcome.kind === "invalid") {
    return `Telegram mengembalikan respons yang tidak valid (HTTP ${outcome.httpStatus}). Coba lagi beberapa saat.`;
  }
  const { errorCode, retryAfterSeconds, httpStatus } = outcome;
  if (errorCode === 401) return "Token bot ditolak Telegram (401). Periksa TELEGRAM_BOT_TOKEN di server.";
  if (errorCode === 404) return "Token bot tidak dikenali Telegram (404). Periksa TELEGRAM_BOT_TOKEN di server.";
  if (errorCode === 429) {
    return retryAfterSeconds
      ? `Telegram membatasi permintaan sementara. Coba lagi dalam ${retryAfterSeconds} detik.`
      : "Telegram membatasi permintaan sementara. Coba lagi beberapa saat.";
  }
  if (errorCode >= 500) return `Layanan Telegram sedang bermasalah (HTTP ${httpStatus}). Coba lagi beberapa saat.`;
  return `Telegram menolak permintaan (${errorCode}). ${outcome.description || ""}`.trim();
}

/** Satu baris log aman: metode, jenis hasil, status, dan kode. Tanpa token, URL, atau isi pesan. */
export function safeLogLine(method: string, outcome: Exclude<ApiOutcome<unknown>, { ok: true }>): string {
  if (outcome.kind === "network") {
    return `[telegram-api] ${method}: tanpa respons HTTP (jenis=${outcome.reason}${outcome.code ? `, kode=${outcome.code}` : ""})`;
  }
  if (outcome.kind === "invalid") return `[telegram-api] ${method}: respons bukan JSON Telegram (HTTP ${outcome.httpStatus})`;
  const retry = outcome.retryAfterSeconds !== null ? `, retry_after=${outcome.retryAfterSeconds}` : "";
  return `[telegram-api] ${method}: HTTP ${outcome.httpStatus}, ok=false, error_code=${outcome.errorCode}${retry}, description=${JSON.stringify(outcome.description.slice(0, 200))}`;
}
