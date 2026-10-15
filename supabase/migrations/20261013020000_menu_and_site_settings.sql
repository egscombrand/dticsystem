-- =============================================================================
-- DTIC Connect — konfigurasi menu sidebar & pengaturan website (dinamis)
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: hanya tabel baru + seed idempoten.
--
-- sidebar_menu_items : daftar menu sidebar yang dapat diatur Super Admin
--                      (visibilitas, label, urutan, role yang boleh melihat).
--                      Visibilitas TIDAK pernah melebihi kapabilitas server:
--                      aplikasi memakai irisan allowed_roles dan izin required_capability.
-- site_settings      : satu baris pengaturan umum (nama sistem, tagline, default sidebar).
--
-- Penjagaan di database:
--   * menu inti (is_core) selalu terlihat dan selalu mencakup super_admin
--   * menu inti tidak bisa dihapus
--   * allowed_roles hanya berisi role yang valid dan tidak kosong
-- =============================================================================

create table if not exists public.sidebar_menu_items (
  key                   text primary key check (key ~ '^[a-z][a-z0-9_-]{1,40}$'),
  parent_key            text references public.sidebar_menu_items (key) on update cascade on delete restrict,
  label                 text not null check (char_length(btrim(label)) between 1 and 60),
  href                  text not null check (href ~ '^/' and char_length(href) <= 200),
  icon                  text not null check (icon in ('dashboard', 'list', 'kanban', 'calendar', 'file-plus', 'users', 'settings', 'shield', 'history', 'sliders', 'globe', 'database', 'layers')),
  required_capability   text not null check (required_capability in ('dashboard.view', 'orders.view_all', 'orders.update', 'members.view', 'master.manage', 'users.manage', 'site.manage', 'audit.view')),
  allowed_roles         text[] not null check (cardinality(allowed_roles) >= 1 and allowed_roles <@ array['super_admin', 'manager', 'staff']::text[]),
  is_visible            boolean not null default true,
  is_core               boolean not null default false,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint sidebar_menu_items_not_self_parent check (parent_key is null or parent_key <> key),
  constraint sidebar_menu_items_core_visible check (not is_core or (is_visible and 'super_admin' = any (allowed_roles)))
);

create index if not exists sidebar_menu_items_parent_idx on public.sidebar_menu_items (parent_key);

drop trigger if exists sidebar_menu_items_touch_updated_at on public.sidebar_menu_items;
create trigger sidebar_menu_items_touch_updated_at before update on public.sidebar_menu_items
  for each row execute function public.dtic_touch_updated_at();

create or replace function public.dtic_guard_core_menu() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.is_core then raise exception 'Menu inti tidak dapat dihapus.'; end if;
    return old;
  end if;
  if new.is_core and (not new.is_visible or not ('super_admin' = any (new.allowed_roles))) then
    raise exception 'Menu inti harus tetap terlihat dan dapat diakses Super Admin.';
  end if;
  return new;
end;
$$;

drop trigger if exists sidebar_menu_items_guard_core on public.sidebar_menu_items;
create trigger sidebar_menu_items_guard_core before insert or update or delete on public.sidebar_menu_items
  for each row execute function public.dtic_guard_core_menu();

-- Seed menu (idempoten). Urutan & label dapat diubah Super Admin dari dashboard.
insert into public.sidebar_menu_items (key, parent_key, label, href, icon, required_capability, allowed_roles, is_core, sort_order) values
  ('dashboard',  null,       'Dashboard',          '/dtic/dashboard',          'dashboard', 'dashboard.view',   array['super_admin','manager','staff'], true,  10),
  ('orders',     null,       'Daftar Order',       '/dtic/orders',             'list',      'dashboard.view',   array['super_admin','manager','staff'], false, 20),
  ('workboard',  null,       'Workboard',          '/dtic/workboard',          'kanban',    'dashboard.view',   array['super_admin','manager','staff'], false, 30),
  ('calendar',   null,       'Kalender',           '/dtic/calendar',           'calendar',  'dashboard.view',   array['super_admin','manager','staff'], false, 40),
  ('intake',     null,       'Form Pengajuan',     '/',                        'file-plus', 'dashboard.view',   array['manager'],                       false, 50),
  ('members',    null,       'Anggota DTIC',       '/dtic/settings/members',   'users',     'members.view',     array['super_admin','manager'],         false, 60),
  ('settings',   null,       'Pengaturan',         '/dtic/settings',           'settings',  'master.manage',    array['super_admin'],                   false, 70),
  ('master',     'settings', 'Master Data',        '/dtic/settings/brands',    'database',  'master.manage',    array['super_admin'],                   false, 71),
  ('website',    'settings', 'Pengaturan Website', '/dtic/settings/website',   'globe',     'site.manage',      array['super_admin'],                   true,  72),
  ('menu',       'settings', 'Pengaturan Menu',    '/dtic/settings/menu',      'sliders',   'site.manage',      array['super_admin'],                   true,  73),
  ('users',      null,       'Pengguna & Role',    '/dtic/settings/users',     'shield',    'users.manage',     array['super_admin'],                   true,  80),
  ('integrations', 'settings', 'Integrasi Telegram', '/dtic/settings/integrations', 'layers', 'site.manage', array['super_admin'],                   true,  74),
  ('audit',      null,       'Audit Aktivitas',    '/dtic/settings/audit',     'history',   'audit.view',       array['super_admin'],                   true,  90)
on conflict (key) do nothing;

-- Form Pengajuan adalah halaman publik untuk pemohon, bukan menu operasional Super Admin.
-- Pembaruan ini idempoten: menghapus super_admin dari menu intake bila pernah ditambahkan lewat UI.
update public.sidebar_menu_items set allowed_roles = array['manager']
where key = 'intake' and 'super_admin' = any (allowed_roles);

create table if not exists public.site_settings (
  id                        smallint primary key default 1 check (id = 1),
  system_name               text not null check (char_length(btrim(system_name)) between 2 and 60),
  tagline                   text not null default '' check (char_length(tagline) <= 120),
  sidebar_default_collapsed boolean not null default false,
  updated_by                uuid references public.app_users (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

drop trigger if exists site_settings_touch_updated_at on public.site_settings;
create trigger site_settings_touch_updated_at before update on public.site_settings
  for each row execute function public.dtic_touch_updated_at();

insert into public.site_settings (id, system_name, tagline) values
  (1, 'DTIC Connect', 'One Portal for Creative & IT Requests')
on conflict (id) do nothing;

alter table public.sidebar_menu_items enable row level security;
alter table public.site_settings enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.sidebar_menu_items, public.site_settings from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.sidebar_menu_items, public.site_settings from authenticated;
  end if;
end;
$$;
