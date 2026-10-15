import "server-only";

/**
 * Rate limiter sliding-window di memori proses.
 * Cukup untuk satu instance server. Untuk deployment multi-instance/serverless,
 * ganti dengan penyimpanan bersama (mis. Redis/Upstash) — lihat docs/SECURITY.md.
 */
type Bucket = { hits: number[] };

declare global {
  var __dticRateLimit: Map<string, Bucket> | undefined;
}

const store = (globalThis.__dticRateLimit ??= new Map<string, Bucket>());

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const bucket = store.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    store.set(key, bucket);
    const retryAfterMs = windowMs - (now - bucket.hits[0]);
    return { ok: false as const, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  bucket.hits.push(now);
  store.set(key, bucket);
  if (store.size > 10_000) {
    for (const [k, b] of store) if (b.hits.every((t) => now - t >= windowMs)) store.delete(k);
  }
  return { ok: true as const, remaining: limit - bucket.hits.length };
}

/** IP klien. Hanya akurat bila server berada di belakang proxy tepercaya yang mengisi X-Forwarded-For. */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim().slice(0, 64);
  return request.headers.get("x-real-ip")?.trim().slice(0, 64) || "unknown";
}
