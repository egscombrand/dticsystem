-- =============================================================================
-- Riwayat percobaan notifikasi Telegram per tiket Bantuan & Masukan — mencatat SETIAP percobaan (otomatis
-- saat tiket dibuat, maupun manual lewat tombol "Kirim ke Telegram" di halaman detail Super Admin), supaya
-- Super Admin bisa melihat jenis pengiriman, aktor, dan hasil tiap percobaan — bukan hanya status terakhir
-- (feedback_notifications tetap dipakai apa adanya untuk antrean otomatis; tabel ini murni tambahan histori,
-- tidak menggantikan atau mengubah perilakunya).
-- =============================================================================

create table if not exists public.feedback_notification_attempts (
  id             uuid primary key default gen_random_uuid(),
  ticket_id      uuid not null references public.feedback_tickets (id) on delete cascade,
  kind           text not null check (kind in ('auto', 'manual')),
  status         text not null check (status in ('sent', 'failed')),
  actor_user_id  uuid references public.app_users (id) on delete set null,
  actor_name     text check (actor_name is null or char_length(actor_name) <= 120),
  error          text check (error is null or char_length(error) <= 300),
  attempted_at   timestamptz not null default now()
);

create index if not exists feedback_notification_attempts_ticket_idx on public.feedback_notification_attempts (ticket_id, attempted_at desc);

alter table public.feedback_notification_attempts enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.feedback_notification_attempts from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.feedback_notification_attempts from authenticated;
  end if;
end;
$$;
