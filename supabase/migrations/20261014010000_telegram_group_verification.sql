-- =============================================================================
-- DTIC Connect — verifikasi grup Telegram dari link (per brand)
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: hanya kolom baru + perluasan constraint. Tidak ada data yang dihapus.
-- Belum diterapkan ke production: menunggu persetujuan dan prosedur deployment.
--
-- Konfigurasi hanya dibuat setelah verifikasi berhasil (chat_id berasal dari Telegram Bot API,
-- bukan dari input manual). Grup tidak terverifikasi tidak menerima notifikasi produksi.
--
-- source_link       : link yang dipakai Super Admin (dinormalisasi). Tidak mengandung token.
-- chat_title/_username : identitas dari Telegram (tepercaya) untuk ditampilkan.
-- verified_at       : waktu verifikasi berhasil terakhir.
-- last_test_result  : hasil tes pesan terakhir ('ok' | 'failed') + last_test_message yang sudah disanitasi.
-- test_locked_until : kunci singkat agar klik ganda tidak mengirim beberapa pesan tes.
-- =============================================================================

alter table public.telegram_brand_channels add column if not exists source_link text
  check (source_link is null or char_length(source_link) <= 300);
alter table public.telegram_brand_channels add column if not exists chat_title text
  check (chat_title is null or char_length(chat_title) <= 200);
alter table public.telegram_brand_channels add column if not exists chat_username text
  check (chat_username is null or char_length(chat_username) <= 64);
alter table public.telegram_brand_channels add column if not exists verified_at timestamptz;
alter table public.telegram_brand_channels add column if not exists last_test_result text
  check (last_test_result is null or last_test_result in ('ok', 'failed'));
alter table public.telegram_brand_channels add column if not exists last_test_message text
  check (last_test_message is null or char_length(last_test_message) <= 300);
alter table public.telegram_brand_channels add column if not exists test_locked_until timestamptz;

-- Konfigurasi baru belum aktif: harus diverifikasi lalu diaktifkan secara eksplisit.
alter table public.telegram_brand_channels alter column is_active set default false;

alter table public.telegram_brand_channels drop constraint if exists telegram_brand_channels_verification_status_check;
alter table public.telegram_brand_channels add constraint telegram_brand_channels_verification_status_check
  check (verification_status in ('unverified', 'verified', 'bot_no_access', 'failed'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'telegram_brand_channels_verified_at_check' and conrelid = 'public.telegram_brand_channels'::regclass) then
    alter table public.telegram_brand_channels add constraint telegram_brand_channels_verified_at_check
      check (verification_status <> 'verified' or verified_at is not null);
  end if;
end;
$$;

-- Hanya grup terverifikasi yang boleh aktif.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'telegram_brand_channels_active_requires_verified_check' and conrelid = 'public.telegram_brand_channels'::regclass) then
    alter table public.telegram_brand_channels add constraint telegram_brand_channels_active_requires_verified_check
      check (not is_active or verification_status = 'verified');
  end if;
end;
$$;
