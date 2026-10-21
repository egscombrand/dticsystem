-- =============================================================================
-- Sinkronisasi metadata Google Drive -> aplikasi, per order (bukan upload ulang file).
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: kolom baru pada order_attachments (nullable, baris lama tidak berubah) + satu tabel
-- baru order_drive_sync (status sinkronisasi per order, terpisah dari sync_status per-file yang sudah ada).
--
-- reconcile_status: 'missing' (file tidak ditemukan lagi di Drive saat sinkronisasi — TIDAK dihapus dari
-- DB, hanya ditandai untuk pemeriksaan manusia) atau 'moved_out' (file pindah ke folder di luar folder
-- kategori order ini — TIDAK otomatis dikaitkan ke order lain). null = tidak ada masalah (keadaan normal).
-- =============================================================================

alter table public.order_attachments
  add column if not exists drive_modified_time timestamptz,
  add column if not exists reconcile_status text,
  add column if not exists reconciled_at timestamptz;

alter table public.order_attachments drop constraint if exists order_attachments_reconcile_status_check;
alter table public.order_attachments add constraint order_attachments_reconcile_status_check
  check (reconcile_status is null or reconcile_status in ('missing', 'moved_out'));

create table if not exists public.order_drive_sync (
  order_id             uuid primary key references public.orders (id) on delete cascade,
  last_sync_at         timestamptz,
  last_sync_status     text check (last_sync_status is null or last_sync_status in ('success', 'partial', 'failed')),
  last_sync_message    text check (last_sync_message is null or char_length(last_sync_message) <= 500),
  -- Sewa singkat (pola sama dengan order_attachments.sync_locked_at) agar tombol Sinkronkan yang ditekan
  -- berulang atau dibuka di beberapa tab tidak memicu beberapa sinkronisasi bersamaan untuk order yang sama.
  last_sync_locked_at  timestamptz
);

alter table public.order_drive_sync enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.order_drive_sync from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.order_drive_sync from authenticated;
  end if;
end;
$$;
