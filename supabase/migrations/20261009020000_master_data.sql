-- =============================================================================
-- DTIC System — data master dinamis, prioritas, rich text brief, URL Google Drive
-- -----------------------------------------------------------------------------
-- Aman dijalankan ulang (idempoten):
--   * tabel baru: CREATE TABLE IF NOT EXISTS
--   * seed: INSERT ... ON CONFLICT DO NOTHING (tidak menimpa data yang sudah diubah admin)
--   * kolom baru di orders: ADD COLUMN IF NOT EXISTS (nullable)
-- Perubahan skema yang bukan "tambah": CHECK prioritas lama (low/normal/high/urgent)
-- diganti FOREIGN KEY ke priority_levels(code). Tidak ada tabel/kolom/data yang dihapus;
-- order berprioritas 'high' (bila ada) dipetakan ke 'urgent' karena level awal hanya tiga.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Brand: ganti nama sementara (Brand 1–5) dengan lima brand DTIC.
-- Hanya baris yang MASIH bernama & ber-slug sementara yang diubah (id tetap → relasi
-- order lama aman). Brand yang belum ada ditambahkan. Tidak menimpa perubahan admin.
-- -----------------------------------------------------------------------------
with seed(old_slug, old_name, name, slug, sort_order) as (
  values
    ('brand-1', 'Brand 1', 'PT Environesia Global Saraya', 'environesia', 1),
    ('brand-2', 'Brand 2', 'PT Greenlab Indo Global',      'greenlab',    2),
    ('brand-3', 'Brand 3', 'Greenskill ID',                'greenskill-id', 3),
    ('brand-4', 'Brand 4', 'LSP PLI',                      'lsp-pli',     4),
    ('brand-5', 'Brand 5', 'Bikin.co',                     'bikin-co',    5)
)
update public.brands b
set name = s.name, slug = s.slug, sort_order = s.sort_order
from seed s
where b.slug = s.old_slug and b.name = s.old_name
  and not exists (select 1 from public.brands x where x.slug = s.slug or lower(x.name) = lower(s.name));

insert into public.brands (name, slug, sort_order) values
  ('PT Environesia Global Saraya', 'environesia',   1),
  ('PT Greenlab Indo Global',      'greenlab',      2),
  ('Greenskill ID',                'greenskill-id', 3),
  ('LSP PLI',                      'lsp-pli',       4),
  ('Bikin.co',                     'bikin-co',      5)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Divisi internal DTIC
-- -----------------------------------------------------------------------------
create table if not exists public.dtic_departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  slug        text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint dtic_departments_slug_key unique (slug)
);
create unique index if not exists dtic_departments_name_lower_key on public.dtic_departments (lower(name));

insert into public.dtic_departments (name, slug, sort_order) values
  ('Creative',             'creative',             1),
  ('Video Production',     'video-production',     2),
  ('Advertiser',           'advertiser',           3),
  ('IT System Management', 'it-system-management', 4),
  ('Graphic Design',       'graphic-design',       5)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Member DTIC
-- -----------------------------------------------------------------------------
create table if not exists public.dtic_members (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null check (char_length(btrim(full_name)) between 2 and 120),
  department_id  uuid not null references public.dtic_departments (id) on update cascade on delete restrict,
  position       text not null default 'Staff' check (char_length(btrim(position)) between 2 and 80),
  email          text check (email is null or (char_length(email) <= 160 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists dtic_members_full_name_lower_key on public.dtic_members (lower(full_name));
create index if not exists dtic_members_department_id_idx on public.dtic_members (department_id);

insert into public.dtic_members (full_name, department_id, position, sort_order)
select m.full_name, d.id, 'Staff', m.sort_order
from (values
  ('Nuri Khusnaini',                    'creative',             1),
  ('Hibatul Azizi Aminullah',           'creative',             2),
  ('Hikmatud Diyana',                   'creative',             3),
  ('Stevan Hary Laksono',               'video-production',     4),
  ('Muhammad Reza Alamsyah',            'advertiser',           5),
  ('Dolly Ilham saputra Huta Julu',     'it-system-management', 6),
  ('Luthfi Imam Tauchid Faried Akbar',  'it-system-management', 7),
  ('Gilar Dwi Rahayu',                  'graphic-design',       8),
  ('Fathin Maqbulloh Sawiji',           'graphic-design',       9)
) as m(full_name, dept_slug, sort_order)
join public.dtic_departments d on d.slug = m.dept_slug
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Jenis order desain (sebelumnya konstanta di kode)
-- requires_detail = client wajib menuliskan jenisnya sendiri (opsi "Lainnya").
-- -----------------------------------------------------------------------------
create table if not exists public.design_order_types (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(btrim(name)) between 2 and 60),
  requires_detail  boolean not null default false,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists design_order_types_name_lower_key on public.design_order_types (lower(name));

insert into public.design_order_types (name, requires_detail, sort_order) values
  ('Poster',                  false, 1),
  ('Banner / Spanduk',        false, 2),
  ('Flyer / Leaflet',         false, 3),
  ('Brosur',                  false, 4),
  ('Kartu Nama',              false, 5),
  ('Konten Media Sosial',     false, 6),
  ('Presentasi',              false, 7),
  ('Packaging / Label',       false, 8),
  ('Sertifikat / Piagam',     false, 9),
  ('Undangan',                false, 10),
  ('Logo / Identitas Visual', false, 11),
  ('Lainnya',                 true,  99)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Level prioritas (tiga level awal). code = identifier stabil yang disimpan di orders.
-- tone = warna badge (dipetakan di UI, bukan CSS bebas).
-- -----------------------------------------------------------------------------
create table if not exists public.priority_levels (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]{1,29}$'),
  name        text not null check (char_length(btrim(name)) between 2 and 40),
  tone        text not null default 'neutral'
                check (tone in ('muted', 'neutral', 'accent', 'info', 'success', 'warning', 'danger')),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists priority_levels_name_lower_key on public.priority_levels (lower(name));

insert into public.priority_levels (code, name, tone, sort_order) values
  ('low',    'Rendah', 'muted',   1),
  ('normal', 'Normal', 'neutral', 2),
  ('urgent', 'Urgent', 'danger',  3)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- orders: relasi jenis order & prioritas, brief rich text, URL Google Drive
-- -----------------------------------------------------------------------------
alter table public.orders add column if not exists design_order_type_id uuid
  references public.design_order_types (id) on update cascade on delete restrict;
create index if not exists orders_design_order_type_id_idx on public.orders (design_order_type_id);

-- Backfill: cocokkan teks jenis desain lama dengan tabel; sisanya → "Lainnya" (teks tetap tersimpan).
update public.orders o set design_order_type_id = t.id
from public.design_order_types t
where o.design_order_type_id is null and lower(t.name) = lower(o.design_type);

update public.orders o set design_order_type_id = t.id
from public.design_order_types t
where o.design_order_type_id is null and t.requires_detail and lower(t.name) = 'lainnya';

-- Dokumen Tiptap/ProseMirror (JSON) yang sudah divalidasi server; orders.brief tetap
-- menyimpan versi teks polos untuk pencarian, judul, dan cadangan tampilan.
alter table public.orders add column if not exists brief_rich jsonb;
alter table public.orders add column if not exists drive_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_brief_rich_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_brief_rich_check
      check (brief_rich is null or (jsonb_typeof(brief_rich) = 'object' and octet_length(brief_rich::text) <= 200000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_drive_url_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_drive_url_check
      check (drive_url is null or (char_length(drive_url) <= 2000 and drive_url ~ '^https://(drive|docs)\.google\.com/'));
  end if;
end;
$$;

-- Prioritas: CHECK daftar tetap → FOREIGN KEY ke priority_levels.
update public.orders set priority = 'urgent' where priority = 'high';

do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.orders'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%priority%'
  loop
    execute format('alter table public.orders drop constraint %I', c.conname);
  end loop;

  if not exists (select 1 from pg_constraint where conname = 'orders_priority_fkey' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_priority_fkey
      foreign key (priority) references public.priority_levels (code) on update cascade on delete restrict;
  end if;
end;
$$;
create index if not exists orders_priority_idx on public.orders (priority);

-- -----------------------------------------------------------------------------
-- updated_at otomatis & hak akses minimum (sama dengan tabel lain)
-- -----------------------------------------------------------------------------
drop trigger if exists dtic_departments_touch_updated_at on public.dtic_departments;
create trigger dtic_departments_touch_updated_at before update on public.dtic_departments
  for each row execute function public.dtic_touch_updated_at();
drop trigger if exists dtic_members_touch_updated_at on public.dtic_members;
create trigger dtic_members_touch_updated_at before update on public.dtic_members
  for each row execute function public.dtic_touch_updated_at();
drop trigger if exists design_order_types_touch_updated_at on public.design_order_types;
create trigger design_order_types_touch_updated_at before update on public.design_order_types
  for each row execute function public.dtic_touch_updated_at();
drop trigger if exists priority_levels_touch_updated_at on public.priority_levels;
create trigger priority_levels_touch_updated_at before update on public.priority_levels
  for each row execute function public.dtic_touch_updated_at();

alter table public.dtic_departments   enable row level security;
alter table public.dtic_members       enable row level security;
alter table public.design_order_types enable row level security;
alter table public.priority_levels    enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.dtic_departments, public.dtic_members, public.design_order_types, public.priority_levels from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.dtic_departments, public.dtic_members, public.design_order_types, public.priority_levels from authenticated;
  end if;
end;
$$;
