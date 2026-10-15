-- =============================================================================
-- DTIC Connect — login internal & role-based access control
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: hanya membuat tabel baru. Tidak mengubah atau menghapus data order.
--
-- Model:
--   app_users        akun internal (satu baris per orang). Password disimpan sebagai
--                    hash scrypt, TIDAK pernah plaintext. Role dibatasi di database.
--   app_sessions     sesi login. Token acak dikirim ke browser sebagai cookie httpOnly;
--                    database hanya menyimpan SHA-256-nya.
--   auth_audit_log   jejak perubahan akun & role (siapa, kapan, apa).
--
-- Penjagaan di database (selain validasi aplikasi):
--   * role hanya: super_admin | manager | staff
--   * satu akun per anggota DTIC (member_id unik bila terisi)
--   * tidak boleh ada nol Super Admin aktif (trigger)
-- =============================================================================

create table if not exists public.app_users (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null check (char_length(btrim(full_name)) between 2 and 120),
  email               text not null
                        check (email = lower(email) and char_length(email) between 5 and 160
                               and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  password_hash       text not null check (password_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$'),
  role                text not null check (role in ('super_admin', 'manager', 'staff')),
  member_id           uuid references public.dtic_members (id) on update cascade on delete restrict,
  is_active           boolean not null default true,
  failed_login_count  integer not null default 0 check (failed_login_count >= 0),
  locked_until        timestamptz,
  last_login_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint app_users_email_key unique (email)
);

create unique index if not exists app_users_member_id_key on public.app_users (member_id) where member_id is not null;
create index if not exists app_users_role_idx on public.app_users (role);

drop trigger if exists app_users_touch_updated_at on public.app_users;
create trigger app_users_touch_updated_at before update on public.app_users
  for each row execute function public.dtic_touch_updated_at();

create table if not exists public.app_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.app_users (id) on delete cascade,
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  ip            text check (ip is null or char_length(ip) <= 64),
  user_agent    text check (user_agent is null or char_length(user_agent) <= 300),
  constraint app_sessions_expiry_check check (expires_at > created_at)
);

create index if not exists app_sessions_user_id_idx on public.app_sessions (user_id);
create index if not exists app_sessions_expires_at_idx on public.app_sessions (expires_at);

create table if not exists public.auth_audit_log (
  id              bigint generated always as identity primary key,
  actor_user_id   uuid references public.app_users (id) on delete set null,
  target_user_id  uuid references public.app_users (id) on delete set null,
  action          text not null check (char_length(action) between 2 and 60),
  detail          jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at      timestamptz not null default now()
);

create index if not exists auth_audit_log_created_at_idx on public.auth_audit_log (created_at desc);

-- Tidak boleh ada nol Super Admin aktif: cegah demote/nonaktifkan/hapus Super Admin terakhir.
create or replace function public.dtic_guard_last_super_admin() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.role = 'super_admin' and old.is_active
       and (new.role <> 'super_admin' or not new.is_active) then
      if not exists (select 1 from public.app_users
                     where role = 'super_admin' and is_active and id <> old.id) then
        raise exception 'Tidak dapat menghapus hak Super Admin aktif terakhir.';
      end if;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.role = 'super_admin' and old.is_active
       and not exists (select 1 from public.app_users
                       where role = 'super_admin' and is_active and id <> old.id) then
      raise exception 'Tidak dapat menghapus Super Admin aktif terakhir.';
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists app_users_guard_last_super_admin on public.app_users;
create trigger app_users_guard_last_super_admin before update or delete on public.app_users
  for each row execute function public.dtic_guard_last_super_admin();

-- RLS aktif tanpa policy untuk anon/authenticated: akses hanya lewat server (koneksi DATABASE_URL).
alter table public.app_users       enable row level security;
alter table public.app_sessions    enable row level security;
alter table public.auth_audit_log  enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.app_users, public.app_sessions, public.auth_audit_log from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.app_users, public.app_sessions, public.auth_audit_log from authenticated;
  end if;
end;
$$;
