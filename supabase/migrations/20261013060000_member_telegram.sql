-- =============================================================================
-- DTIC Connect — identitas Telegram anggota DTIC (pendataan manual)
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: hanya menambah kolom nullable + constraint + indeks unik parsial.
-- Anggota lama tetap valid (status default 'not_linked', semua kolom Telegram kosong).
--
-- telegram_display_name : nama tampilan Telegram (wajib diisi di aplikasi bila ada data Telegram).
-- telegram_username     : username tanpa "@", huruf kecil (format Telegram: 5–32 karakter).
-- telegram_user_id      : ID numerik pengguna Telegram, disimpan sebagai teks (aman dari batas integer).
-- telegram_status       : not_linked (belum ada data) | recorded (terdata manual) | verified (hanya bila
--                         ada mekanisme verifikasi; aplikasi saat ini TIDAK pernah mengisi 'verified').
--
-- Satu identitas Telegram tidak boleh terhubung ke dua anggota (indeks unik parsial).
-- =============================================================================

alter table public.dtic_members add column if not exists telegram_display_name text;
alter table public.dtic_members add column if not exists telegram_username text;
alter table public.dtic_members add column if not exists telegram_user_id text;
alter table public.dtic_members add column if not exists telegram_status text not null default 'not_linked';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dtic_members_telegram_display_name_check' and conrelid = 'public.dtic_members'::regclass) then
    alter table public.dtic_members add constraint dtic_members_telegram_display_name_check
      check (telegram_display_name is null or char_length(btrim(telegram_display_name)) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dtic_members_telegram_username_check' and conrelid = 'public.dtic_members'::regclass) then
    alter table public.dtic_members add constraint dtic_members_telegram_username_check
      check (telegram_username is null or telegram_username ~ '^[a-z][a-z0-9_]{4,31}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dtic_members_telegram_user_id_check' and conrelid = 'public.dtic_members'::regclass) then
    alter table public.dtic_members add constraint dtic_members_telegram_user_id_check
      check (telegram_user_id is null or telegram_user_id ~ '^[1-9][0-9]{0,19}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dtic_members_telegram_status_check' and conrelid = 'public.dtic_members'::regclass) then
    alter table public.dtic_members add constraint dtic_members_telegram_status_check
      check (telegram_status in ('not_linked', 'recorded', 'verified'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dtic_members_telegram_status_consistent' and conrelid = 'public.dtic_members'::regclass) then
    alter table public.dtic_members add constraint dtic_members_telegram_status_consistent
      check ((telegram_status = 'not_linked') = (telegram_display_name is null and telegram_username is null and telegram_user_id is null));
  end if;
end;
$$;

create unique index if not exists dtic_members_telegram_user_id_key on public.dtic_members (telegram_user_id) where telegram_user_id is not null;
create unique index if not exists dtic_members_telegram_username_key on public.dtic_members (telegram_username) where telegram_username is not null;
