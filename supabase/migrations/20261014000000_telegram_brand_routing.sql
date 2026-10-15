-- =============================================================================
-- DTIC Connect — routing notifikasi Telegram per BRAND
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: tabel baru + kolom baru nullable di notification_outbox. Tidak ada
-- tabel order, brand, atau konfigurasi lama yang dihapus/diubah strukturnya.
--
-- Prinsip: brand pada order menentukan grup Telegram tujuan. Tidak ada fallback ke
-- TELEGRAM_CHAT_ID global. Notifikasi yang tidak punya tujuan valid dicatat sebagai
-- 'skipped' dengan alasan, dan order tetap tersimpan.
--
-- telegram_brand_channels : satu grup utama per brand (unique brand_id). Chat ID unik
--                           (unique chat_id): satu grup tidak dipakai dua brand tanpa
--                           keputusan konfigurasi eksplisit. Aturan jenis notifikasi
--                           disimpan sebagai kolom boolean (default aktif).
-- notification_outbox     : snapshot tujuan saat antrean dibuat (brand_id, config_id, chat_id),
--                           jenis event (event_type), dan kode error Telegram yang aman (error_code).
--
-- Baris outbox lama yang belum terkirim (tanpa brand) ditandai 'skipped': sebelum fitur ini
-- tujuannya selalu TELEGRAM_CHAT_ID global, sehingga tidak boleh dikirim otomatis lintas brand.
-- =============================================================================

create table if not exists public.telegram_brand_channels (
  id                          uuid primary key default gen_random_uuid(),
  brand_id                    uuid not null references public.brands (id) on update cascade on delete restrict,
  chat_id                     text not null check (chat_id ~ '^(-?[0-9]{1,20}|@[A-Za-z][A-Za-z0-9_]{4,})$'),
  is_active                   boolean not null default true,
  verification_status         text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'failed')),
  notify_new_order            boolean not null default true,
  notify_status_changed       boolean not null default true,
  notify_waiting_confirmation boolean not null default true,
  notify_completed            boolean not null default true,
  notify_on_hold              boolean not null default true,
  notify_cancelled            boolean not null default true,
  last_tested_at              timestamptz,
  created_by                  uuid references public.app_users (id) on delete set null,
  updated_by                  uuid references public.app_users (id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint telegram_brand_channels_brand_key unique (brand_id),
  constraint telegram_brand_channels_chat_key unique (chat_id)
);

drop trigger if exists telegram_brand_channels_touch_updated_at on public.telegram_brand_channels;
create trigger telegram_brand_channels_touch_updated_at before update on public.telegram_brand_channels
  for each row execute function public.dtic_touch_updated_at();

alter table public.telegram_brand_channels enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.telegram_brand_channels from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.telegram_brand_channels from authenticated;
  end if;
end;
$$;

-- Kolom tujuan & jejak pengiriman pada outbox (nullable: baris lama tetap valid).
alter table public.notification_outbox add column if not exists brand_id uuid references public.brands (id) on delete set null;
alter table public.notification_outbox add column if not exists config_id uuid references public.telegram_brand_channels (id) on delete set null;
alter table public.notification_outbox add column if not exists chat_id text check (chat_id is null or char_length(chat_id) <= 40);
alter table public.notification_outbox add column if not exists event_type text;
alter table public.notification_outbox add column if not exists error_code integer;

alter table public.notification_outbox drop constraint if exists notification_outbox_event_type_check;
alter table public.notification_outbox add constraint notification_outbox_event_type_check
  check (event_type is null or event_type in ('new_order', 'status_changed', 'waiting_confirmation', 'completed', 'on_hold', 'cancelled'));

-- Status 'skipped' = tidak dikirim karena alasan tercatat (tanpa grup, grup nonaktif, jenis dimatikan).
alter table public.notification_outbox drop constraint if exists notification_outbox_status_v2_check;
alter table public.notification_outbox add constraint notification_outbox_status_v3_check
  check (status in ('pending', 'processing', 'retrying', 'sent', 'failed', 'skipped'));

-- Baris lama tanpa tujuan brand: jangan dikirim ke chat global. Hanya yang belum terkirim.
update public.notification_outbox
set status = 'skipped',
    last_error = 'Dibuat sebelum routing per brand; tidak dikirim otomatis. Kirim ulang manual bila masih diperlukan.',
    locked_at = null
where channel = 'telegram' and config_id is null and status in ('pending', 'processing', 'retrying');

-- Pengiriman pending wajib punya tujuan (chat) yang tercatat.
alter table public.notification_outbox drop constraint if exists notification_outbox_target_check;
alter table public.notification_outbox add constraint notification_outbox_target_check
  check (status not in ('pending', 'processing', 'retrying') or chat_id is not null);

create index if not exists notification_outbox_brand_idx on public.notification_outbox (brand_id, created_at);

-- Menu Super Admin: "Integrasi Telegram per Brand" (idempoten).
insert into public.sidebar_menu_items (key, parent_key, label, href, icon, required_capability, allowed_roles, is_core, sort_order) values
  ('telegram_brands', 'settings', 'Integrasi Telegram per Brand', '/dtic/settings/integrations/brands', 'layers', 'site.manage', array['super_admin'], true, 75)
on conflict (key) do nothing;
