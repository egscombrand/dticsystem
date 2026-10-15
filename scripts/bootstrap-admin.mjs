/**
 * Membuat akun Super Admin awal (bootstrap). Idempotent:
 *  - jika email sudah terdaftar, TIDAK mengubah apa pun (tidak mengambil alih akun);
 *  - password tidak pernah dicetak.
 *
 * Pemakaian (dari folder proyek):
 *   BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_NAME="…" BOOTSTRAP_ADMIN_PASSWORD=… \
 *   DATABASE_URL=… node scripts/bootstrap-admin.mjs
 */
import postgres from "postgres";
import { hashPassword, passwordPolicyError } from "../src/lib/auth/password.mjs";

const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase();
const name = (process.env.BOOTSTRAP_ADMIN_NAME ?? "").trim();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
const url = process.env.DATABASE_URL ?? "";

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!url) fail("DATABASE_URL belum diisi.");
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 160) fail("BOOTSTRAP_ADMIN_EMAIL tidak valid.");
if (name.length < 2 || name.length > 120) fail("BOOTSTRAP_ADMIN_NAME wajib diisi (2–120 karakter).");
const policy = passwordPolicyError(password);
if (policy) fail(`BOOTSTRAP_ADMIN_PASSWORD: ${policy}`);

const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
const hasSslParam = /[?&](sslmode|ssl)=/.test(url);
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, ...(hasSslParam ? {} : { ssl: local ? false : "require" }) });

try {
  const existing = await sql`select id, role from app_users where email = ${email}`;
  if (existing.length > 0) {
    console.log(`• Akun ${email} sudah ada (role ${existing[0].role}). Tidak ada perubahan.`);
  } else {
    const hash = await hashPassword(password);
    const [row] = await sql`
      insert into app_users (full_name, email, password_hash, role, is_active)
      values (${name}, ${email}, ${hash}, 'super_admin', true)
      on conflict (email) do nothing
      returning id`;
    if (row) {
      await sql`insert into auth_audit_log (actor_user_id, target_user_id, action, detail)
                values (null, ${row.id}, 'bootstrap_super_admin', ${sql.json({ email })})`;
      console.log(`✓ Super Admin awal dibuat: ${email}`);
    } else {
      console.log(`• Akun ${email} sudah ada. Tidak ada perubahan.`);
    }
  }
} catch (error) {
  console.error("✗ Bootstrap gagal:", error instanceof Error ? error.message : "kesalahan tidak diketahui");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
