-- =============================================================================
-- DTIC Connect — grup Telegram default & status "menunggu tujuan"
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: tidak ada data yang dihapus. Belum diterapkan ke production.
--
-- Grup default disimpan di tabel yang SAMA dengan grup brand (telegram_brand_channels), sebagai satu baris
-- dengan brand_id = null. Verifikasi link, tes pesan, aktif/nonaktif, dan riwayat memakai alur yang sama.
-- Urutan tujuan notifikasi: grup brand aktif → grup default aktif → menunggu tujuan.
--
-- notification_outbox.status 'awaiting_destination': event sudah tercatat tetapi belum ada grup tujuan aktif.
-- Worker memindahkannya ke antrean kirim begitu tujuan tersedia (tanpa membuat event atau pengajuan baru).
-- =============================================================================

alter table public.telegram_brand_channels alter column brand_id drop not null;

-- Paling banyak satu grup default.
create unique index if not exists telegram_brand_channels_default_key
  on public.telegram_brand_channels ((brand_id is null)) where brand_id is null;

alter table public.notification_outbox drop constraint if exists notification_outbox_status_v3_check;
alter table public.notification_outbox drop constraint if exists notification_outbox_status_v4_check;
alter table public.notification_outbox add constraint notification_outbox_status_v4_check
  check (status in ('pending', 'processing', 'retrying', 'sent', 'failed', 'skipped', 'awaiting_destination'));

create index if not exists notification_outbox_awaiting_idx on public.notification_outbox (created_at)
  where status = 'awaiting_destination';
