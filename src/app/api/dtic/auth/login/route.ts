import { z } from "zod";
import { dummyPasswordHash, verifyPassword } from "@/lib/auth/password.mjs";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { createSession, sessionCookieHeader } from "@/lib/server/auth";
import { sql } from "@/lib/server/db";
import { isRole } from "@/lib/auth/permissions";
import { MAX_PASSWORD_LENGTH } from "@/lib/auth/password.mjs";

const schema = z
  .object({
    email: z.string().trim().toLowerCase().min(5, "Email wajib diisi.").max(160),
    password: z.string().min(1, "Kata sandi wajib diisi.").max(MAX_PASSWORD_LENGTH),
  })
  .strict();

/** Pesan seragam: tidak membedakan email tidak terdaftar, akun nonaktif, terkunci, atau password salah. */
const GENERIC = "Email atau kata sandi salah.";

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Email dan kata sandi wajib diisi.", 422);
    const { email, password } = parsed.data;

    const ip = rateLimit(`login-ip:${clientIp(request)}`, 30, 15 * 60_000);
    const perEmail = rateLimit(`login-email:${email}`, 10, 15 * 60_000);
    if (!ip.ok || !perEmail.ok) {
      const retry = Math.max(ip.ok ? 0 : ip.retryAfterSeconds, perEmail.ok ? 0 : perEmail.retryAfterSeconds);
      return json({ error: "Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi." }, 429, { "Retry-After": String(retry) });
    }

    const rows = await sql()<
      { id: string; password_hash: string; role: string; is_active: boolean; failed_login_count: number; locked_until: Date | null }[]
    >`select id, password_hash, role, is_active, failed_login_count, locked_until from app_users where email = ${email}`;
    const user = rows[0];

    // Selalu jalankan verifikasi hash agar waktu respons sama untuk email yang ada & tidak ada.
    const storedHash = user?.password_hash ?? (await dummyPasswordHash());
    const passwordOk = await verifyPassword(password, storedHash);
    const locked = !!user?.locked_until && user.locked_until.getTime() > Date.now();

    if (!user || !passwordOk || !user.is_active || locked || !isRole(user.role)) {
      if (user && !locked && user.is_active) {
        const count = user.failed_login_count + 1;
        const lockNow = count >= LOCK_AFTER;
        await sql()`
          update app_users
          set failed_login_count = ${lockNow ? 0 : count},
              locked_until = ${lockNow ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null}
          where id = ${user.id}`;
        if (lockNow) {
          await sql()`insert into auth_audit_log (target_user_id, action, detail)
                      values (${user.id}, 'account_locked', ${sql().json({ minutes: LOCK_MINUTES })})`;
        }
      }
      throw new AppError(GENERIC, 401);
    }

    await sql()`update app_users set failed_login_count = 0, locked_until = null, last_login_at = now() where id = ${user.id}`;
    const session = await createSession(user.id, { request });
    await sql()`insert into auth_audit_log (actor_user_id, target_user_id, action) values (${user.id}, ${user.id}, 'login')`;

    const response = json({ ok: true, role: user.role });
    response.headers.append("Set-Cookie", sessionCookieHeader(session.token, session.maxAgeSeconds));
    return response;
  } catch (error) {
    return errorResponse(error, "POST auth/login");
  }
}
