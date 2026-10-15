-- =============================================================================
-- DTIC System — Langkah 1: skema awal
-- -----------------------------------------------------------------------------
-- Migration ini NON-DESTRUKTIF: hanya membuat objek baru (IF NOT EXISTS /
-- CREATE OR REPLACE). Tidak ada DROP TABLE / DROP COLUMN / DELETE data.
-- Jalankan sekali melalui Supabase SQL Editor atau `npm run db:migrate`.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- brands
-- -----------------------------------------------------------------------------
create table if not exists public.brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  slug        text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint brands_slug_key unique (slug)
);

create unique index if not exists brands_name_lower_key on public.brands (lower(name));

-- Nama sementara Brand 1–5 (diganti nama asli oleh migration 20261009020000).
-- Hanya diisi bila tabel brand masih kosong, sehingga menjalankan ulang file ini
-- tidak memunculkan kembali placeholder setelah brand diganti nama.
insert into public.brands (name, slug, sort_order)
select v.name, v.slug, v.sort_order
from (values
  ('Brand 1', 'brand-1', 1),
  ('Brand 2', 'brand-2', 2),
  ('Brand 3', 'brand-3', 3),
  ('Brand 4', 'brand-4', 4),
  ('Brand 5', 'brand-5', 5)
) as v(name, slug, sort_order)
where not exists (select 1 from public.brands)
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- Penghitung nomor order per tahun (aman terhadap pengajuan bersamaan:
-- INSERT .. ON CONFLICT DO UPDATE mengunci baris tahun tersebut).
-- -----------------------------------------------------------------------------
create table if not exists public.order_number_counters (
  year        integer primary key check (year between 2000 and 9999),
  last_value  integer not null default 0 check (last_value >= 0)
);

-- -----------------------------------------------------------------------------
-- orders
-- -----------------------------------------------------------------------------
create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),
  order_number        text not null,
  submission_key      uuid not null,
  requester_name      text not null check (char_length(btrim(requester_name)) between 2 and 120),
  company             text not null check (char_length(btrim(company)) between 2 and 120),
  department          text not null check (char_length(btrim(department)) between 2 and 120),
  brand_id            uuid not null references public.brands (id) on update cascade on delete restrict,
  design_type         text not null check (char_length(design_type) between 1 and 60),
  design_size         text not null check (char_length(design_size) between 1 and 120),
  title               text not null check (char_length(btrim(title)) between 3 and 160),
  brief               text not null check (char_length(btrim(brief)) between 10 and 5000),
  brief_year          integer check (brief_year between 1900 and 2100),
  brief_reference     text check (char_length(brief_reference) <= 2000),
  design_requirements text check (char_length(design_requirements) <= 3000),
  deadline_at         timestamptz not null,
  priority            text not null default 'normal'
                        check (priority in ('low', 'normal', 'high', 'urgent')),
  status              text not null default 'new_request'
                        check (status in ('new_request', 'need_information', 'queued', 'in_progress',
                                          'review', 'revision', 'completed', 'closed')),
  internal_notes      text check (char_length(internal_notes) <= 10000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz,
  constraint orders_order_number_key unique (order_number),
  constraint orders_submission_key_key unique (submission_key),
  constraint orders_order_number_format check (order_number ~ '^DTIC-[0-9]{4}-[0-9]{5,}$')
);

create index if not exists orders_brand_id_idx    on public.orders (brand_id);
create index if not exists orders_status_idx      on public.orders (status);
create index if not exists orders_deadline_at_idx on public.orders (deadline_at);
create index if not exists orders_created_at_idx  on public.orders (created_at desc);
create index if not exists orders_priority_idx    on public.orders (priority);

-- -----------------------------------------------------------------------------
-- order_attachments
-- -----------------------------------------------------------------------------
create table if not exists public.order_attachments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  file_name     text not null check (char_length(file_name) between 1 and 255),
  storage_path  text not null check (char_length(storage_path) between 1 and 512),
  mime_type     text not null check (char_length(mime_type) between 1 and 127),
  file_size     bigint not null check (file_size > 0),
  created_at    timestamptz not null default now(),
  constraint order_attachments_storage_path_key unique (storage_path)
);

create index if not exists order_attachments_order_id_idx on public.order_attachments (order_id);

-- -----------------------------------------------------------------------------
-- order_status_history
-- -----------------------------------------------------------------------------
create table if not exists public.order_status_history (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  previous_status  text,
  new_status       text not null,
  changed_at       timestamptz not null default now(),
  notes            text check (char_length(notes) <= 1000)
);

create index if not exists order_status_history_order_id_idx
  on public.order_status_history (order_id, changed_at);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

-- updated_at otomatis
create or replace function public.dtic_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists brands_touch_updated_at on public.brands;
create trigger brands_touch_updated_at
  before update on public.brands
  for each row execute function public.dtic_touch_updated_at();

-- Nomor order DTIC-YYYY-NNNNN (tahun menurut Asia/Jakarta), dibuat di database
-- sehingga tidak pernah bentrok walaupun ada pengajuan bersamaan.
create or replace function public.dtic_assign_order_number() returns trigger
language plpgsql as $$
declare
  v_year  integer := extract(year from (now() at time zone 'Asia/Jakarta'))::integer;
  v_next  integer;
begin
  insert into public.order_number_counters as c (year, last_value)
  values (v_year, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning c.last_value into v_next;

  new.order_number := 'DTIC-' || v_year || '-' || lpad(v_next::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists orders_assign_order_number on public.orders;
create trigger orders_assign_order_number
  before insert on public.orders
  for each row execute function public.dtic_assign_order_number();

-- Field yang tidak boleh diubah setelah order dibuat + completed_at + updated_at
create or replace function public.dtic_orders_before_update() returns trigger
language plpgsql as $$
begin
  new.id             := old.id;
  new.order_number   := old.order_number;
  new.submission_key := old.submission_key;
  new.created_at     := old.created_at;
  new.updated_at     := now();

  if new.status is distinct from old.status then
    if new.status in ('completed', 'closed') then
      new.completed_at := coalesce(old.completed_at, now());
    else
      new.completed_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_before_update on public.orders;
create trigger orders_before_update
  before update on public.orders
  for each row execute function public.dtic_orders_before_update();

-- Setiap perubahan status (dan status awal) tercatat di riwayat.
-- Catatan opsional diteruskan lewat set_config('dtic.status_note', ..., true).
create or replace function public.dtic_orders_status_history() returns trigger
language plpgsql as $$
declare
  v_note text := nullif(current_setting('dtic.status_note', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (order_id, previous_status, new_status, notes)
    values (new.id, null, new.status, coalesce(v_note, 'Order diajukan'));
  elsif new.status is distinct from old.status then
    insert into public.order_status_history (order_id, previous_status, new_status, notes)
    values (new.id, old.status, new.status, v_note);
  end if;
  return null;
end;
$$;

drop trigger if exists orders_status_history on public.orders;
create trigger orders_status_history
  after insert or update of status on public.orders
  for each row execute function public.dtic_orders_status_history();

-- -----------------------------------------------------------------------------
-- Hak akses minimum
-- Aplikasi mengakses database HANYA dari server (DATABASE_URL). Role publik
-- Supabase (anon/authenticated) tidak diberi akses apa pun lewat PostgREST:
-- RLS aktif tanpa policy = semua akses ditolak untuk role tersebut.
-- -----------------------------------------------------------------------------
alter table public.brands                enable row level security;
alter table public.orders                enable row level security;
alter table public.order_attachments     enable row level security;
alter table public.order_status_history  enable row level security;
alter table public.order_number_counters enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.brands, public.orders, public.order_attachments,
                  public.order_status_history, public.order_number_counters from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.brands, public.orders, public.order_attachments,
                  public.order_status_history, public.order_number_counters from authenticated;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Supabase Storage: bucket PRIVAT untuk dokumen pendukung.
-- Dilewati otomatis bila skema storage tidak ada (mis. Postgres lokal).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('order-attachments', 'order-attachments', false, 10485760)
    on conflict (id) do nothing;
  end if;
end;
$$;
