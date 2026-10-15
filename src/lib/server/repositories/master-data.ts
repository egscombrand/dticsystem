import { deriveTelegramStatus } from "@/lib/member-telegram";
import "server-only";
import type { z } from "zod";
import { MASTER_SCHEMAS, type MasterEntity, type MasterRow } from "@/lib/master-data";
import { sql } from "@/lib/server/db";
import { AppError, NotFoundError, pgConstraint, pgErrorCode } from "@/lib/server/errors";
import { DEFAULT_PRIORITY_CODE } from "@/lib/server/config";
import type { DepartmentOption, MemberOption, OrderTypeOption, PriorityOption, TeamOption } from "@/lib/types";

type Input<E extends MasterEntity> = z.output<(typeof MASTER_SCHEMAS)[E]>;

// ---------------------------------------------------------------------------
// Opsi untuk form (hanya data aktif kecuali diminta)
// ---------------------------------------------------------------------------


export async function listOrderTypes(opts: { activeOnly?: boolean } = {}): Promise<OrderTypeOption[]> {
  const db = sql();
  const rows = await db<{ id: string; name: string; requires_detail: boolean; is_active: boolean; team_id: string | null }[]>`
    select id, name, requires_detail, is_active, team_id from design_order_types
    ${opts.activeOnly ? db`where is_active` : db``}
    order by sort_order, name`;
  return rows.map((r) => ({ id: r.id, name: r.name, requiresDetail: r.requires_detail, isActive: r.is_active, teamId: r.team_id }));
}

/**
 * Tim aktif beserta anggota AKTIF (untuk form publik). Hanya id & nama yang dikirim ke browser.
 * Anggota yang bukan anggota tim (mis. tidak lagi menerima pengajuan) tidak muncul.
 */
export async function listTeamsWithMembers(): Promise<TeamOption[]> {
  const teams = await sql()<{ id: string; slug: string; name: string; description: string }[]>`
    select id, slug, name, description from dtic_teams where is_active order by sort_order, name`;
  const members = await sql()<{ team_id: string; id: string; full_name: string }[]>`
    select tm.team_id, m.id, m.full_name
    from dtic_team_members tm join dtic_members m on m.id = tm.member_id
    where m.is_active order by m.sort_order, m.full_name`;
  return teams.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description,
    members: members.filter((m) => m.team_id === t.id).map((m) => ({ id: m.id, name: m.full_name })),
  }));
}

export async function listPriorities(opts: { activeOnly?: boolean } = {}): Promise<PriorityOption[]> {
  const db = sql();
  const rows = await db<{ code: string; name: string; tone: string; is_active: boolean }[]>`
    select code, name, tone, is_active from priority_levels
    ${opts.activeOnly ? db`where is_active` : db``}
    order by sort_order, name`;
  return rows.map((r) => ({ code: r.code, name: r.name, tone: r.tone, isActive: r.is_active }));
}

export async function listDepartmentOptions(): Promise<DepartmentOption[]> {
  const rows = await sql()<{ id: string; name: string; is_active: boolean }[]>`
    select id, name, is_active from dtic_departments order by sort_order, name`;
  return rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active }));
}

/** Tim untuk field Master Data (jenis pekerjaan → tim). */
export async function listTeamAdminOptions(): Promise<DepartmentOption[]> {
  const rows = await sql()<{ id: string; name: string; is_active: boolean }[]>`select id, name, is_active from dtic_teams order by sort_order, name`;
  return rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active }));
}

/** Member DTIC untuk penugasan PIC (semua; UI hanya menawarkan yang aktif kecuali sudah ditugaskan). */
/** Anggota aktif per tim (satu kueri), untuk halaman yang menampilkan banyak pekerjaan dari beberapa tim. */
export async function listTeamMemberOptionsByTeam(): Promise<Record<string, MemberOption[]>> {
  const rows = await sql()<{ team_id: string; id: string; full_name: string; position: string; department_name: string; is_active: boolean }[]>`
    select tm.team_id, m.id, m.full_name, m.position, d.name as department_name, m.is_active
    from dtic_team_members tm
    join dtic_members m on m.id = tm.member_id
    join dtic_departments d on d.id = m.department_id
    where m.is_active
    order by m.full_name`;
  const out: Record<string, MemberOption[]> = {};
  for (const r of rows) {
    (out[r.team_id] ??= []).push({
      id: r.id,
      name: r.full_name,
      division: `${r.position} of ${r.department_name}`,
      departmentName: r.department_name,
      isActive: r.is_active,
    });
  }
  return out;
}

/** Anggota AKTIF dari satu tim (kandidat PIC untuk order kategori tim tersebut). Kosong bila tim tidak ada. */
export async function listTeamMemberOptions(teamId: string | null): Promise<MemberOption[]> {
  if (!teamId) return [];
  const rows = await sql()<{ id: string; full_name: string; position: string; department_name: string; is_active: boolean }[]>`
    select m.id, m.full_name, m.position, d.name as department_name, m.is_active
    from dtic_team_members tm
    join dtic_members m on m.id = tm.member_id
    join dtic_departments d on d.id = m.department_id
    where tm.team_id = ${teamId} and m.is_active
    order by m.full_name`;
  return rows.map((r) => ({
    id: r.id,
    name: r.full_name,
    division: `${r.position} of ${r.department_name}`,
    departmentName: r.department_name,
    isActive: r.is_active,
  }));
}

export async function listMemberOptions(): Promise<MemberOption[]> {
  const rows = await sql()<{ id: string; full_name: string; position: string; department_name: string; is_active: boolean; dept_active: boolean }[]>`
    select m.id, m.full_name, m.position, d.name as department_name, m.is_active, d.is_active as dept_active
    from dtic_members m join dtic_departments d on d.id = m.department_id
    order by d.sort_order, d.name, m.sort_order, m.full_name`;
  return rows.map((r) => ({
    id: r.id,
    name: r.full_name,
    division: `${r.position} of ${r.department_name}`,
    departmentName: r.department_name,
    isActive: r.is_active,
  }));
}

/** Prioritas default dari konfigurasi server; bila nonaktif/tidak ada → level aktif pertama. */
export async function resolveDefaultPriority(): Promise<string> {
  const rows = await sql()<{ code: string }[]>`
    select code from priority_levels where is_active
    order by (code = ${DEFAULT_PRIORITY_CODE}) desc, sort_order, name limit 1`;
  if (!rows[0]) throw new AppError("Belum ada level prioritas aktif. Hubungi tim DTIC.", 503);
  return rows[0].code;
}

// ---------------------------------------------------------------------------
// Daftar untuk halaman pengaturan
// ---------------------------------------------------------------------------

export async function listMasterRows(entity: MasterEntity): Promise<MasterRow[]> {
  const db = sql();
  switch (entity) {
    case "brands": {
      const rows = await db<{ id: string; name: string; slug: string; sort_order: number; is_active: boolean; usage: number }[]>`
        select b.id, b.name, b.slug, b.sort_order, b.is_active, (select count(*)::int from orders o where o.brand_id = b.id) as usage
        from brands b order by b.sort_order, b.name`;
      return rows.map((r) => ({ id: r.id, values: { name: r.name, slug: r.slug, sortOrder: r.sort_order, isActive: r.is_active }, usage: r.usage, subtitle: `${r.slug} · ${r.usage} order` }));
    }
    case "departments": {
      const rows = await db<{ id: string; name: string; slug: string; sort_order: number; is_active: boolean; usage: number }[]>`
        select d.id, d.name, d.slug, d.sort_order, d.is_active, (select count(*)::int from dtic_members m where m.department_id = d.id) as usage
        from dtic_departments d order by d.sort_order, d.name`;
      return rows.map((r) => ({ id: r.id, values: { name: r.name, slug: r.slug, sortOrder: r.sort_order, isActive: r.is_active }, usage: r.usage, subtitle: `${r.slug} · ${r.usage} member` }));
    }
    case "members": {
      const rows = await db<{ id: string; full_name: string; department_id: string; department_name: string; position: string; email: string | null; sort_order: number; is_active: boolean; telegram_display_name: string | null; telegram_username: string | null; telegram_user_id: string | null; telegram_status: string; account_role: string | null }[]>`
        select m.id, m.full_name, m.department_id, d.name as department_name, m.position, m.email, m.sort_order, m.is_active,
               m.telegram_display_name, m.telegram_username, m.telegram_user_id, m.telegram_status,
               (select u.role from app_users u where u.member_id = m.id) as account_role
        from dtic_members m join dtic_departments d on d.id = m.department_id
        order by d.sort_order, m.sort_order, m.full_name`;
      return rows.map((r) => ({
        id: r.id,
        values: {
          fullName: r.full_name, departmentId: r.department_id, position: r.position, email: r.email, sortOrder: r.sort_order, isActive: r.is_active,
          telegramDisplayName: r.telegram_display_name, telegramUsername: r.telegram_username, telegramUserId: r.telegram_user_id, telegramStatus: r.telegram_status,
          accountRole: r.account_role,
        },
        usage: 0,
        subtitle: `${r.position} of ${r.department_name}${r.email ? ` · ${r.email}` : ""}`,
      }));
    }
    case "order-types": {
      const rows = await db<{ id: string; name: string; team_id: string | null; team_name: string | null; requires_detail: boolean; sort_order: number; is_active: boolean; usage: number }[]>`
        select t.id, t.name, t.team_id, tm.name as team_name, t.requires_detail, t.sort_order, t.is_active,
               (select count(*)::int from orders o where o.design_order_type_id = t.id) as usage
        from design_order_types t left join dtic_teams tm on tm.id = t.team_id order by t.sort_order, t.name`;
      return rows.map((r) => ({
        id: r.id,
        values: { name: r.name, teamId: r.team_id ?? "", requiresDetail: r.requires_detail, sortOrder: r.sort_order, isActive: r.is_active },
        usage: r.usage,
        subtitle: `${r.team_name ? `Tim ${r.team_name} · ` : "Belum ada tim (tidak tampil di form) · "}${r.requires_detail ? "Client menulis jenisnya sendiri · " : ""}${r.usage} order`,
      }));
    }
    case "priorities": {
      const rows = await db<{ code: string; name: string; tone: string; sort_order: number; is_active: boolean; usage: number }[]>`
        select p.code, p.name, p.tone, p.sort_order, p.is_active, (select count(*)::int from orders o where o.priority = p.code) as usage
        from priority_levels p order by p.sort_order, p.name`;
      return rows.map((r) => ({
        id: r.code,
        values: { code: r.code, name: r.name, tone: r.tone, sortOrder: r.sort_order, isActive: r.is_active },
        usage: r.usage,
        subtitle: `kode: ${r.code}${r.code === DEFAULT_PRIORITY_CODE ? " · default" : ""} · ${r.usage} order`,
      }));
    }
  }
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

function conflict(error: unknown): never {
  const code = pgErrorCode(error);
  const c = pgConstraint(error) ?? "";
  if (code === "23505") {
    if (c.includes("slug")) throw new AppError("Slug sudah dipakai.", 409, { slug: "Slug sudah dipakai." });
    if (c.includes("pkey")) throw new AppError("Kode sudah dipakai.", 409, { code: "Kode sudah dipakai." });
    if (c.includes("full_name")) throw new AppError("Nama member sudah ada.", 409, { fullName: "Nama member sudah ada." });
    if (c.includes("telegram_user_id")) throw new AppError("Telegram User ID ini sudah terhubung dengan anggota lain.", 409, { telegramUserId: "Sudah dipakai anggota lain." });
    if (c.includes("telegram_username")) throw new AppError("Username Telegram ini sudah terhubung dengan anggota lain.", 409, { telegramUsername: "Sudah dipakai anggota lain." });
    throw new AppError("Nama sudah dipakai.", 409, { name: "Nama sudah dipakai." });
  }
  if (code === "23503") throw new AppError("Divisi tidak ditemukan.", 422, { departmentId: "Divisi tidak ditemukan." });
  if (code === "23514") throw new AppError("Data tidak memenuhi aturan validasi database.", 422);
  throw error;
}

async function guardPriorityDeactivation(code: string, isActive: boolean) {
  if (!isActive && code === DEFAULT_PRIORITY_CODE)
    throw new AppError("Prioritas default tidak boleh dinonaktifkan.", 422, { isActive: "Prioritas default (konfigurasi server) harus tetap aktif." });
}

async function guardDepartmentForMember(departmentId: string, currentId?: string) {
  const rows = await sql()<{ is_active: boolean; same: boolean }[]>`
    select d.is_active, exists(select 1 from dtic_members m where m.id = ${currentId ?? null} and m.department_id = d.id) as same
    from dtic_departments d where d.id = ${departmentId}`;
  if (!rows[0]) throw new AppError("Divisi tidak ditemukan.", 422, { departmentId: "Divisi tidak ditemukan." });
  if (!rows[0].is_active && !rows[0].same) throw new AppError("Divisi nonaktif.", 422, { departmentId: "Divisi nonaktif tidak bisa dipilih." });
}

export async function createMasterRow<E extends MasterEntity>(entity: E, input: Input<E>): Promise<string> {
  const db = sql();
  const so = (input as { sortOrder?: number }).sortOrder ?? 0;
  try {
    switch (entity) {
      case "brands": {
        const v = input as Input<"brands">;
        const [r] = await db<{ id: string }[]>`insert into brands (name, slug, sort_order, is_active) values (${v.name}, ${v.slug}, ${so}, ${v.isActive}) returning id`;
        return r.id;
      }
      case "departments": {
        const v = input as Input<"departments">;
        const [r] = await db<{ id: string }[]>`insert into dtic_departments (name, slug, sort_order, is_active) values (${v.name}, ${v.slug}, ${so}, ${v.isActive}) returning id`;
        return r.id;
      }
      case "members": {
        const v = input as Input<"members">;
        await guardDepartmentForMember(v.departmentId);
        const tg = { displayName: v.telegramDisplayName, username: v.telegramUsername, userId: v.telegramUserId };
        const [r] = await db<{ id: string }[]>`
          insert into dtic_members (full_name, department_id, position, email, sort_order, is_active,
            telegram_display_name, telegram_username, telegram_user_id, telegram_status)
          values (${v.fullName}, ${v.departmentId}, ${v.position}, ${v.email}, ${so}, ${v.isActive},
            ${tg.displayName}, ${tg.username}, ${tg.userId}, ${deriveTelegramStatus(tg)}) returning id`;
        return r.id;
      }
      case "order-types": {
        const v = input as Input<"order-types">;
        const [r] = await db<{ id: string }[]>`
          insert into design_order_types (name, team_id, requires_detail, sort_order, is_active) values (${v.name}, ${v.teamId}, ${v.requiresDetail}, ${so}, ${v.isActive}) returning id`;
        return r.id;
      }
      case "priorities": {
        const v = input as Input<"priorities">;
        if (!v.code) throw new AppError("Kode wajib diisi.", 422, { code: "Kode wajib diisi." });
        const [r] = await db<{ code: string }[]>`
          insert into priority_levels (code, name, tone, sort_order, is_active) values (${v.code}, ${v.name}, ${v.tone}, ${so}, ${v.isActive}) returning code`;
        return r.code;
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    conflict(error);
  }
  throw new AppError("Entitas tidak dikenal.", 404);
}

export async function updateMasterRow<E extends MasterEntity>(entity: E, id: string, input: Input<E>): Promise<void> {
  const db = sql();
  const so = (input as { sortOrder?: number }).sortOrder ?? null;
  let rows: readonly unknown[] = [];
  try {
    switch (entity) {
      case "brands": {
        const v = input as Input<"brands">;
        rows = await db`update brands set name = ${v.name}, slug = ${v.slug}, sort_order = coalesce(${so}, sort_order), is_active = ${v.isActive} where id = ${id} returning id`;
        break;
      }
      case "departments": {
        const v = input as Input<"departments">;
        rows = await db`update dtic_departments set name = ${v.name}, slug = ${v.slug}, sort_order = coalesce(${so}, sort_order), is_active = ${v.isActive} where id = ${id} returning id`;
        break;
      }
      case "members": {
        const v = input as Input<"members">;
        await guardDepartmentForMember(v.departmentId, id);
        const tg = { displayName: v.telegramDisplayName, username: v.telegramUsername, userId: v.telegramUserId };
        // Belum ada mekanisme verifikasi: status dihitung ulang dari data (terdata / belum dihubungkan).
        rows = await db`
          update dtic_members set full_name = ${v.fullName}, department_id = ${v.departmentId}, position = ${v.position},
            email = ${v.email}, sort_order = coalesce(${so}, sort_order), is_active = ${v.isActive},
            telegram_display_name = ${tg.displayName}, telegram_username = ${tg.username}, telegram_user_id = ${tg.userId},
            telegram_status = ${deriveTelegramStatus(tg)}
          where id = ${id} returning id`;
        break;
      }
      case "order-types": {
        const v = input as Input<"order-types">;
        rows = await db`update design_order_types set name = ${v.name}, team_id = ${v.teamId}, requires_detail = ${v.requiresDetail}, sort_order = coalesce(${so}, sort_order), is_active = ${v.isActive} where id = ${id} returning id`;
        break;
      }
      case "priorities": {
        const v = input as Input<"priorities">;
        await guardPriorityDeactivation(id, v.isActive);
        // Kode (primary key) sengaja tidak bisa diubah.
        rows = await db`update priority_levels set name = ${v.name}, tone = ${v.tone}, sort_order = coalesce(${so}, sort_order), is_active = ${v.isActive} where code = ${id} returning code`;
        break;
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    conflict(error);
  }
  if (rows.length === 0) throw new NotFoundError("Data tidak ditemukan.");
}
