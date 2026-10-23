-- =============================================================================
-- Notifikasi Telegram untuk tiket Bantuan & Masukan — grup Tim IT TERPISAH dari grup notifikasi order
-- (telegram_brand_channels tetap murni untuk order). NON-DESTRUKTIF: tabel baru, tidak menyentuh tabel lain.
--
-- feedback_telegram_channel : SATU baris (singleton, pola sama dengan drive_integration_settings) — grup
--                              Tim IT belum aktif menerima notifikasi sampai diverifikasi DAN diaktifkan
--                              secara eksplisit (verifikasi memakai jalur Bot API yang sama dengan grup
--                              order — lihat resolveTelegramGroup di telegram-verify.ts; tautan undangan
--                              TIDAK PERNAH dianggap sebagai chat_id).
-- feedback_notifications    : SATU baris per tiket (unique ticket_id — mencegah notifikasi ganda), diisi
--                              dalam transaksi YANG SAMA dengan pembuatan tiket. Diproses oleh worker
--                              Telegram yang sudah ada (processFeedbackNotifications dipanggil dari tick
--                              yang sama dengan antrean order — lihat telegram-worker.ts), bukan worker baru.
-- =============================================================================

create table if not exists public.feedback_telegram_channel (
  id                  uuid primary key default gen_random_uuid(),
  chat_id             text not null check (chat_id ~ '^(-?[0-9]{1,20}|@[A-Za-z][A-Za-z0-9_]{4,})$'),
  chat_title          text check (chat_title is null or char_length(chat_title) <= 200),
  chat_username       text check (chat_username is null or char_length(chat_username) <= 64),
  source_link         text check (source_link is null or char_length(source_link) <= 300),
  message_thread_id   integer,
  is_active           boolean not null default false,
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'bot_no_access', 'failed')),
  verified_at         timestamptz,
  last_test_result    text check (last_test_result is null or last_test_result in ('ok', 'failed')),
  last_test_message   text check (last_test_message is null or char_length(last_test_message) <= 300),
  last_tested_at      timestamptz,
  test_locked_until   timestamptz,
  created_by          uuid references public.app_users (id) on delete set null,
  updated_by          uuid references public.app_users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint feedback_telegram_channel_active_requires_verified check (not is_active or verification_status = 'verified'),
  constraint feedback_telegram_channel_verified_at_check check (verification_status <> 'verified' or verified_at is not null)
);
-- Singleton: hanya satu baris konfigurasi boleh ada (pola identik drive_integration_settings id=1, di sini
-- lewat indeks unik pada ekspresi konstan karena id dibuat otomatis, bukan ditetapkan tetap).
create unique index if not exists feedback_telegram_channel_singleton_idx on public.feedback_telegram_channel ((true));

drop trigger if exists feedback_telegram_channel_touch_updated_at on public.feedback_telegram_channel;
create trigger feedback_telegram_channel_touch_updated_at before update on public.feedback_telegram_channel
  for each row execute function public.dtic_touch_updated_at();

create table if not exists public.feedback_notifications (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.feedback_tickets (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts    integer not null default 0 check (attempts >= 0),
  last_error  text check (last_error is null or char_length(last_error) <= 300),
  locked_at   timestamptz,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint feedback_notifications_ticket_key unique (ticket_id)
);

create index if not exists feedback_notifications_status_idx on public.feedback_notifications (status, created_at);

drop trigger if exists feedback_notifications_touch_updated_at on public.feedback_notifications;
create trigger feedback_notifications_touch_updated_at before update on public.feedback_notifications
  for each row execute function public.dtic_touch_updated_at();

alter table public.feedback_telegram_channel enable row level security;
alter table public.feedback_notifications enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.feedback_telegram_channel, public.feedback_notifications from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.feedback_telegram_channel, public.feedback_notifications from authenticated;
  end if;
end;
$$;
