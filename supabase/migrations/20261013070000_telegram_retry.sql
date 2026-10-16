-- =============================================================================
-- DTIC Connect — retry otomatis notifikasi Telegram (outbox + penjadwalan)
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: tidak menghapus baris. Status lama 'sending' dipetakan ke 'processing'.
--
-- Status: pending (menunggu) · processing (sedang dikirim, dilindungi lease) · retrying (gagal sementara,
--         dijadwalkan) · sent (terkirim) · failed (error permanen atau percobaan habis).
-- next_attempt_at : kapan percobaan berikutnya boleh dijalankan (worker hanya mengambil yang sudah jatuh tempo).
-- max_attempts    : batas total percobaan (default 5).
-- error_kind      : 'transient' | 'permanent' untuk galat terakhir (aman, tanpa token/URL).
-- =============================================================================

alter table public.notification_outbox drop constraint if exists notification_outbox_status_check;
update public.notification_outbox set status = 'processing' where status = 'sending';

alter table public.notification_outbox add column if not exists next_attempt_at timestamptz not null default now();
alter table public.notification_outbox add column if not exists max_attempts integer not null default 5;
alter table public.notification_outbox add column if not exists error_kind text;

do $$
begin
  -- v2 hanya ditambahkan bila belum ada DAN belum digantikan oleh versi yang lebih baru (v3/v4, migrasi
  -- 20261014000000/20261014020000). Tanpa pengecualian ini, pada database yang statusnya sudah memakai nilai
  -- lebih baru (mis. 'skipped', 'awaiting_destination' — ditambahkan v4) migrasi ini gagal dengan
  -- check_violation karena v2 lebih sempit daripada data yang sudah ada. v2 toh langsung digantikan v3 lalu v4
  -- oleh migrasi berikutnya, jadi melewatinya di sini tidak mengubah hasil akhir.
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_status_v2_check' and conrelid = 'public.notification_outbox'::regclass)
     and not exists (select 1 from pg_constraint where conname in ('notification_outbox_status_v3_check', 'notification_outbox_status_v4_check') and conrelid = 'public.notification_outbox'::regclass) then
    alter table public.notification_outbox add constraint notification_outbox_status_v2_check
      check (status in ('pending', 'processing', 'retrying', 'sent', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_max_attempts_check' and conrelid = 'public.notification_outbox'::regclass) then
    alter table public.notification_outbox add constraint notification_outbox_max_attempts_check
      check (max_attempts between 1 and 10 and attempts <= max_attempts + 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_error_kind_check' and conrelid = 'public.notification_outbox'::regclass) then
    alter table public.notification_outbox add constraint notification_outbox_error_kind_check
      check (error_kind is null or error_kind in ('transient', 'permanent'));
  end if;
end;
$$;

create index if not exists notification_outbox_due_idx on public.notification_outbox (status, next_attempt_at);
