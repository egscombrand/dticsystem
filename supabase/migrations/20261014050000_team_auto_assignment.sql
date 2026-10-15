-- =============================================================================
-- DTIC Connect — penugasan otomatis berbasis TIM
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: tabel & kolom baru (nullable), seed idempoten. Tidak ada order, akun, penugasan,
-- riwayat, atau audit yang dihapus/diubah. Order lama tetap memakai PIC yang sudah tersimpan.
-- Belum diterapkan ke production.
--
-- dtic_teams         : tim penanggung jawab (Graphic Design, IT System Management, Dokumentasi & Event).
-- dtic_team_members  : anggota tim → dtic_members (identitas PIC yang sudah dipakai order_assignments).
-- design_order_types.team_id : jenis pekerjaan termasuk kategori/tim mana.
-- orders.team_id     : tim yang menangani order (null untuk order lama).
-- Satu pengajuan = satu order; SEMUA anggota aktif tim ditetapkan sebagai PIC order itu (order_assignments,
-- primary key (order_id, member_id) mencegah duplikasi).
-- =============================================================================

create table if not exists public.dtic_teams (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 300),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint dtic_teams_slug_key unique (slug)
);

create table if not exists public.dtic_team_members (
  team_id    uuid not null references public.dtic_teams (id) on update cascade on delete cascade,
  member_id  uuid not null references public.dtic_members (id) on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  constraint dtic_team_members_pkey primary key (team_id, member_id)
);
create index if not exists dtic_team_members_member_idx on public.dtic_team_members (member_id);

alter table public.design_order_types add column if not exists team_id uuid references public.dtic_teams (id) on update cascade on delete restrict;
alter table public.orders add column if not exists team_id uuid references public.dtic_teams (id) on update cascade on delete restrict;
create index if not exists orders_team_id_idx on public.orders (team_id);

drop trigger if exists dtic_teams_touch_updated_at on public.dtic_teams;
create trigger dtic_teams_touch_updated_at before update on public.dtic_teams
  for each row execute function public.dtic_touch_updated_at();

alter table public.dtic_teams enable row level security;
alter table public.dtic_team_members enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.dtic_teams from anon;
    revoke all on public.dtic_team_members from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.dtic_teams from authenticated;
    revoke all on public.dtic_team_members from authenticated;
  end if;
end;
$$;

-- Tim (idempoten).
insert into public.dtic_teams (slug, name, description, sort_order) values
  ('graphic-design',       'Graphic Design',       'Poster, banner, brosur, flyer, media sosial, layout & materi publikasi, desain grafis lainnya.', 1),
  ('it-system-management', 'IT System Management', 'Website, sistem internal, perbaikan bug & troubleshooting, integrasi sistem, kebutuhan IT lainnya.', 2),
  ('dokumentasi-event',    'Dokumentasi & Event',  'Dokumentasi event, fotografi & videografi, peliputan kegiatan, dokumentasi acara lainnya.', 3)
on conflict (slug) do nothing;

-- Anggota tim: dicocokkan ke dtic_members yang SUDAH ADA (nama lengkap; nama/username Telegram hanya bantuan).
-- Tidak membuat anggota/akun baru. Yang tidak ditemukan dilaporkan sebagai WARNING.
do $$
declare
  r record;
  found_id uuid;
begin
  for r in
    select * from (values
      ('graphic-design',       'Gilar Dwi Rahayu',                 'Durr'),
      ('graphic-design',       'Fathin Maqbulloh Sawiji',          'Fathin Ms'),
      ('it-system-management', 'Luthfi Imam Tauchid Faried Akbar', 'lutfiimamtfa'),
      ('it-system-management', 'Dolly Ilham Saputra Huta Julu',    'Doly Ilham Saputra Huta Julu'),
      ('dokumentasi-event',    'Nuri Khusnaini',                   'nuwiw'),
      ('dokumentasi-event',    'Hikmatud Diyana',                  'dididu'),
      ('dokumentasi-event',    'Stevan Hary Laksono',              'Stevan')
    ) as s(team_slug, full_name, alias)
  loop
    select m.id into found_id from public.dtic_members m
    where lower(m.full_name) = lower(r.full_name)
    limit 1;
    if found_id is null then
      select m.id into found_id from public.dtic_members m
      where lower(coalesce(m.telegram_display_name, '')) = lower(r.alias) or lower(coalesce(m.telegram_username, '')) = lower(r.alias)
      limit 1;
    end if;
    if found_id is null then
      raise warning 'Anggota tim tidak ditemukan: % (%) untuk tim %. Tidak ditambahkan; periksa data Member DTIC.', r.full_name, r.alias, r.team_slug;
    else
      insert into public.dtic_team_members (team_id, member_id)
      select t.id, found_id from public.dtic_teams t where t.slug = r.team_slug
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

-- Jenis pekerjaan: jenis desain yang sudah ada → Graphic Design (hanya yang belum punya tim).
update public.design_order_types set team_id = (select id from public.dtic_teams where slug = 'graphic-design')
where team_id is null;

-- Jenis pekerjaan untuk IT & Dokumentasi (master data; dapat diubah Super Admin di Master Data).
insert into public.design_order_types (name, requires_detail, sort_order, team_id)
select v.name, v.requires_detail, v.sort_order, t.id
from (values
  ('Website',                         false, 101, 'it-system-management'),
  ('Sistem Internal',                 false, 102, 'it-system-management'),
  ('Perbaikan Bug / Troubleshooting', false, 103, 'it-system-management'),
  ('Integrasi Sistem',                false, 104, 'it-system-management'),
  ('Kebutuhan IT Lainnya',            true,  199, 'it-system-management'),
  ('Dokumentasi Event',               false, 201, 'dokumentasi-event'),
  ('Fotografi',                       false, 202, 'dokumentasi-event'),
  ('Videografi',                      false, 203, 'dokumentasi-event'),
  ('Peliputan Kegiatan',              false, 204, 'dokumentasi-event'),
  ('Kebutuhan Dokumentasi Lainnya',   true,  299, 'dokumentasi-event')
) as v(name, requires_detail, sort_order, team_slug)
join public.dtic_teams t on t.slug = v.team_slug
on conflict do nothing;

-- Jenis dengan nama yang sama yang sudah dibuat admin tanpa tim: kaitkan ke tim yang sesuai (hanya bila belum ada tim).
update public.design_order_types d set team_id = t.id
from (values
  ('website', 'it-system-management'), ('sistem internal', 'it-system-management'),
  ('perbaikan bug / troubleshooting', 'it-system-management'), ('integrasi sistem', 'it-system-management'),
  ('kebutuhan it lainnya', 'it-system-management'),
  ('dokumentasi event', 'dokumentasi-event'), ('fotografi', 'dokumentasi-event'), ('videografi', 'dokumentasi-event'),
  ('peliputan kegiatan', 'dokumentasi-event'), ('kebutuhan dokumentasi lainnya', 'dokumentasi-event')
) as v(lname, team_slug)
join public.dtic_teams t on t.slug = v.team_slug
where lower(d.name) = v.lname and d.team_id is null;
