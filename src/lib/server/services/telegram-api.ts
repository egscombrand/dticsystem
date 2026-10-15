import "server-only";
import { type BotConfig, TELEGRAM_TIMEOUT_MS } from "@/lib/telegram";
import { classifyNetworkError, safeLogLine, type ApiOutcome } from "@/lib/telegram-api";

/**
 * Pemanggil Bot API untuk metode BACA (getMe, getChat, getChatMember). Mengembalikan hasil berjenis jelas
 * (network / invalid / telegram / ok). Galat transport diulang sekali karena metode ini tidak mengubah apa pun.
 * Token hanya ada di URL panggilan dan tidak pernah masuk log atau pesan.
 */
export async function callTelegramApi<T>(bot: BotConfig, method: string, payload: Record<string, unknown>, attempts = 2): Promise<ApiOutcome<T>> {
  let last: ApiOutcome<T> = { ok: false, kind: "network", reason: "unknown", code: null };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${bot.apiBase}/bot${bot.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        redirect: "error",
      });
    } catch (error) {
      last = { ok: false, kind: "network", ...classifyNetworkError(error) };
      continue; // galat transport: coba lagi bila masih ada kesempatan
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const b = (body ?? {}) as { ok?: unknown; result?: T; error_code?: unknown; description?: unknown; parameters?: { retry_after?: unknown } };
    if (res.ok && b.ok === true && b.result !== undefined) return { ok: true, result: b.result };
    if (body && typeof body === "object" && b.ok === false && typeof b.error_code === "number") {
      last = {
        ok: false,
        kind: "telegram",
        httpStatus: res.status,
        errorCode: b.error_code,
        description: typeof b.description === "string" ? b.description : "",
        retryAfterSeconds: typeof b.parameters?.retry_after === "number" ? b.parameters.retry_after : null,
      };
    } else {
      last = { ok: false, kind: "invalid", httpStatus: res.status };
    }
    break; // jawaban Telegram sudah diterima: tidak diulang
  }
  if (!last.ok) console.error(safeLogLine(method, last));
  return last;
}
