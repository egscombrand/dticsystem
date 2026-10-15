import "server-only";
import { hashPassword } from "@/lib/auth/password.mjs";
import type { Role } from "@/lib/auth/permissions";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError, pgConstraint, pgErrorCode } from "@/lib/server/errors";
import { revokeAllUserSessions } from "@/lib/server/auth";

export type UserRow = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  memberId: string | null;
  memberName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export async function listUsers(): Promise<UserRow[]> {
  const rows = await sql()<
    { id: string; full_name: string; email: string; role: Role; member_id: string | null; member_name: string | null; is_active: boolean; last_login_at: Date | null; created_at: Date }[]
  >`
    select u.id, u.full_name, u.email, u.role, u.member_id, m.full_name as member_name, u.is_active, u.last_login_at, u.created_at
    from app_users u left join dtic_members m on m.id = u.member_id
    order by u.is_active desc, u.role, u.full_name`;
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    role: r.role,
    memberId: r.member_id,
    memberName: r.member_name,
    isActive: r.is_active,
    lastLoginAt: r.last_login_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  }));
}

/** Pesan dari trigger/constraint database diteruskan apa adanya bila aman (bukan detail internal). */
function mapDbError(error: unknown): never {
  const code = pgErrorCode(error);
  const constraint = pgConstraint(error) ?? "";
  if (code === "23505") {
    if (constraint.includes("member_id")) throw new AppError("Anggota ini sudah terhubung dengan akun lain.", 409, { memberId: "Anggota ini sudah punya akun." });
    throw new AppError("Email sudah terdaftar.", 409, { email: "Email sudah terdaftar." });
  }
  if (code === "23503") throw new AppError("Anggota DTIC tidak ditemukan.", 422, { memberId: "Anggota DTIC tidak ditemukan." });
  if (code === "P0001" && error instanceof Error) throw new AppError(error.message, 422);
  throw error;
}

export async function createUser(
  input: { fullName: string; email: string; role: Role; memberId: string | null; password: string },
  actorId: string,
): Promise<string> {
  const hash = await hashPassword(input.password);
  try {
    return await sql().begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into app_users (full_name, email, password_hash, role, member_id, is_active)
        values (${input.fullName}, ${input.email}, ${hash}, ${input.role}, ${input.memberId}, true)
        returning id`;
      await tx`insert into auth_audit_log (actor_user_id, target_user_id, action, detail)
               values (${actorId}, ${row.id}, 'user_created', ${tx.json({ email: input.email, role: input.role, memberId: input.memberId })})`;
      return row.id;
    });
  } catch (error) {
    mapDbError(error);
  }
}

export async function updateUser(
  id: string,
  changes: { fullName?: string; role?: Role; memberId?: string | null; isActive?: boolean },
  actorId: string,
) {
  const current = await sql()<{ role: Role; is_active: boolean; full_name: string; member_id: string | null }[]>`
    select role, is_active, full_name, member_id from app_users where id = ${id}`;
  if (!current[0]) throw new NotFoundError("Akun tidak ditemukan.");
  const before = current[0];

  if (id === actorId) {
    if (changes.isActive === false) throw new AppError("Anda tidak dapat menonaktifkan akun sendiri.", 422);
    if (changes.role && changes.role !== before.role) throw new AppError("Anda tidak dapat mengubah role akun sendiri.", 422);
  }

  const deactivated = changes.isActive === false && before.is_active;
  try {
    await sql().begin(async (tx) => {
      await tx`
        update app_users set
          full_name = coalesce(${changes.fullName ?? null}, full_name),
          role = coalesce(${changes.role ?? null}, role),
          member_id = ${changes.memberId === undefined ? before.member_id : changes.memberId},
          is_active = coalesce(${changes.isActive ?? null}, is_active)
        where id = ${id}`;
      await tx`insert into auth_audit_log (actor_user_id, target_user_id, action, detail)
               values (${actorId}, ${id}, 'user_updated', ${tx.json({
                 from: { role: before.role, isActive: before.is_active, memberId: before.member_id },
                 to: changes,
               })})`;
    });
  } catch (error) {
    mapDbError(error);
  }
  // Role dibaca dari database pada setiap permintaan, jadi perubahan role berlaku pada permintaan
  // berikutnya tanpa login ulang. Akun yang dinonaktifkan kehilangan seluruh sesinya.
  if (deactivated) await revokeAllUserSessions(id);
}

export async function resetPassword(id: string, password: string, actorId: string) {
  const hash = await hashPassword(password);
  const rows = await sql()<{ id: string }[]>`update app_users set password_hash = ${hash}, failed_login_count = 0, locked_until = null where id = ${id} returning id`;
  if (rows.length === 0) throw new NotFoundError("Akun tidak ditemukan.");
  await sql()`insert into auth_audit_log (actor_user_id, target_user_id, action) values (${actorId}, ${id}, 'password_reset')`;
  await revokeAllUserSessions(id);
}
