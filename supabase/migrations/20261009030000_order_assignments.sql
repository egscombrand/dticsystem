-- =============================================================================
-- DTIC System — penugasan PIC / Member DTIC pada order (multi-PIC)
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: hanya membuat tabel relasi baru. Satu order bisa memiliki
-- beberapa member; pasangan (order, member) unik (PRIMARY KEY).
-- * Order dihapus  → penugasannya ikut terhapus (CASCADE).
-- * Member tidak bisa dihapus selama masih tercatat (RESTRICT); cukup dinonaktifkan,
--   sehingga riwayat penugasan pada order lama tetap utuh.
-- Data member & divisi sudah di-seed oleh migration 20261009020000_master_data.sql.
-- =============================================================================

create table if not exists public.order_assignments (
  order_id     uuid not null references public.orders (id) on delete cascade,
  member_id    uuid not null references public.dtic_members (id) on update cascade on delete restrict,
  assigned_at  timestamptz not null default now(),
  constraint order_assignments_pkey primary key (order_id, member_id)
);

create index if not exists order_assignments_member_id_idx on public.order_assignments (member_id);

alter table public.order_assignments enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.order_assignments from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.order_assignments from authenticated;
  end if;
end;
$$;
