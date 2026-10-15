import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, isRole, SESSION_COOKIE, type Capability, type Role } from "@/lib/auth/permissions";
import { sql } from "@/lib/server/db";
import { clientIp } from "@/lib/server/rate-limit";
import type { OrderScope } from "@/lib/server/repositories/orders";

export type Session = {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  /** Anggota DTIC yang terhubung dengan akun (untuk pembatasan PIC pada role staff). */
  memberId: string | null;
};

export function sessionTtlHours(): number {
  const raw = Number(process.env.SESSION_TTL_HOURS ?? 12);
  return Number.isFinite(raw) && raw > 0 && raw <= 168 ? raw : 12;
}

function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production" && process.env.SESSION_COOKIE_SECURE !== "false";
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(`dtic-session:${token}`).digest("hex");
}

/** Membuat sesi baru. Token acak 256-bit; database hanya menyimpan hash-nya. */
export async function createSession(userId: string, meta: { request: Request }) {
  const token = randomBytes(32).toString("base64url");
  const ttl = sessionTtlHours();
  const expiresAt = new Date(Date.now() + ttl * 3600_000);
  const userAgent = (meta.request.headers.get("user-agent") ?? "").slice(0, 300) || null;
  await sql()`
    insert into app_sessions (user_id, token_hash, expires_at, ip, user_agent)
    values (${userId}, ${hashSessionToken(token)}, ${expiresAt}, ${clientIp(meta.request)}, ${userAgent})`;
  return { token, expiresAt, maxAgeSeconds: ttl * 3600 };
}

/**
 * Sesi tervalidasi dari token. Role & status akun dibaca dari database setiap kali,
 * sehingga perubahan role/nonaktif berlaku pada permintaan berikutnya.
 */
export async function findSession(token: string | null | undefined): Promise<Session | null> {
  if (!token || token.length > 200) return null;
  const rows = await sql()<
    { session_id: string; user_id: string; full_name: string; email: string; role: string; member_id: string | null }[]
  >`
    select s.id as session_id, u.id as user_id, u.full_name, u.email, u.role, u.member_id
    from app_sessions s
    join app_users u on u.id = s.user_id
    where s.token_hash = ${hashSessionToken(token)}
      and s.revoked_at is null
      and s.expires_at > now()
      and u.is_active`;
  const r = rows[0];
  if (!r || !isRole(r.role)) return null;
  return { sessionId: r.session_id, userId: r.user_id, name: r.full_name, email: r.email, role: r.role, memberId: r.member_id };
}

export async function revokeSessionToken(token: string | null | undefined) {
  if (!token) return;
  await sql()`update app_sessions set revoked_at = now() where token_hash = ${hashSessionToken(token)} and revoked_at is null`;
}

/** Dipanggil saat akun dinonaktifkan atau password direset: semua sesi langsung dicabut. */
export async function revokeAllUserSessions(userId: string) {
  await sql()`update app_sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
}

export function sessionCookieHeader(token: string, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (cookieSecure()) parts.push("Secure");
  return parts.join("; ");
}

export function clearedSessionCookieHeader(): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (cookieSecure()) parts.push("Secure");
  return parts.join("; ");
}

export function tokenFromRequest(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return v.join("=") || null;
  }
  return null;
}

/** Sesi untuk halaman (Server Component). Gunakan di dalam <Suspense> (Cache Components). */
/** Di-cache per render (React cache): layout, halaman, dan komponen anak hanya memicu satu kueri sesi. */
export const getCurrentSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  return findSession(store.get(SESSION_COOKIE)?.value);
});

export type AuthResult = { ok: true; session: Session } | { ok: false; response: Response };

function deny(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Pemeriksaan akses untuk route handler: sesi valid + kapabilitas role.
 * Mengembalikan Response siap pakai bila ditolak. Setiap pemanggil WAJIB memakai hasilnya.
 */
export async function authorize(request: Request, capability: Capability): Promise<AuthResult> {
  const session = await findSession(tokenFromRequest(request));
  if (!session) return { ok: false, response: deny(401, "Sesi login tidak ditemukan. Silakan masuk kembali.") };
  if (!can(session.role, capability)) return { ok: false, response: deny(403, "Anda tidak memiliki izin untuk tindakan ini.") };
  return { ok: true, session };
}

/** Pemeriksaan akses order: Super Admin/Manager semua order; Staff hanya order yang ditugaskan kepadanya. */
export async function canAccessOrder(session: Session, orderId: string): Promise<boolean> {
  if (can(session.role, "orders.view_all")) return true;
  if (!session.memberId) return false;
  const rows = await sql()<{ ok: boolean }[]>`
    select exists(select 1 from order_assignments a where a.order_id = ${orderId} and a.member_id = ${session.memberId}) as ok`;
  return rows[0]?.ok === true;
}

/** Sesi wajib untuk halaman panel. Tanpa sesi → halaman login. */
export async function requireSession(): Promise<Session> {
  const session = await getCurrentSession();
  if (!session) redirect("/dtic/login");
  return session;
}

/** Cakupan order untuk akun ini (Staff dibatasi pada order yang ditugaskan kepadanya). */
export function orderScopeFor(session: Session): OrderScope {
  return session.role === "staff" ? { memberId: session.memberId } : undefined;
}
