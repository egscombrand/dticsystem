-- =============================================================================
-- DTIC Connect — outbox notifikasi (Telegram)
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: hanya tabel baru.
--
-- notification_outbox : satu baris per notifikasi per order. Dibuat DALAM transaksi
--                       penyimpanan order, sehingga notifikasi tidak pernah ada tanpa order.
--                       Pengiriman dilakukan setelah transaksi; status & error (aman, tanpa
--                       token/isi pesan) dicatat di sini.
--
-- Penjagaan:
--   * unique (channel, kind, order_id): satu order hanya punya satu notifikasi per kanal,
--     sehingga kirim ulang request tidak membuat notifikasi ganda.
--   * RLS aktif tanpa policy; anon/authenticated tidak punya hak. Hanya server yang mengakses.
-- =============================================================================

create table if not exists public.notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null check (channel in ('telegram')),
  kind        text not null check (kind in ('order_created')),
  order_id    uuid not null references public.orders (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts    integer not null default 0 check (attempts >= 0),
  last_error  text check (last_error is null or char_length(last_error) <= 300),
  locked_at   timestamptz,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint notification_outbox_once unique (channel, kind, order_id)
);

create index if not exists notification_outbox_status_idx on public.notification_outbox (status, created_at);

drop trigger if exists notification_outbox_touch_updated_at on public.notification_outbox;
create trigger notification_outbox_touch_updated_at before update on public.notification_outbox
  for each row execute function public.dtic_touch_updated_at();

alter table public.notification_outbox enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.notification_outbox from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.notification_outbox from authenticated;
  end if;
end;
$$;
