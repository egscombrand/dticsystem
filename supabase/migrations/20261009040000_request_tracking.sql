-- =============================================================================
-- DTIC Connect — pelacakan request oleh pemohon
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: hanya menambah kolom nullable/default & mengganti fungsi trigger
-- (CREATE OR REPLACE) agar catatan status dapat ditandai "untuk pemohon".
--
-- (Kode pelacakan terpisah dibatalkan — lihat 20261013000000_drop_tracking_code.sql.)
-- * orders.requester_message  : pesan/permintaan informasi yang memang ditujukan ke pemohon.
-- * orders.result_url         : tautan hasil akhir pekerjaan (https) yang boleh dilihat pemohon.
-- * order_status_history.is_public_note : catatan perubahan status boleh dilihat pemohon.
-- =============================================================================

alter table public.orders add column if not exists requester_message text;
alter table public.orders add column if not exists result_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_requester_message_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_requester_message_check
      check (requester_message is null or char_length(requester_message) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_result_url_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_result_url_check
      check (result_url is null or (char_length(result_url) <= 2000 and result_url ~ '^https://'));
  end if;
end;
$$;

alter table public.order_status_history add column if not exists is_public_note boolean not null default false;

-- Trigger riwayat status: catatan & penanda publik diteruskan lewat set_config lokal transaksi.
create or replace function public.dtic_orders_status_history() returns trigger
language plpgsql as $$
declare
  v_note   text    := nullif(current_setting('dtic.status_note', true), '');
  v_public boolean := coalesce(nullif(current_setting('dtic.status_note_public', true), '')::boolean, false);
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (order_id, previous_status, new_status, notes, is_public_note)
    values (new.id, null, new.status, coalesce(v_note, 'Order diajukan'), false);
  elsif new.status is distinct from old.status then
    insert into public.order_status_history (order_id, previous_status, new_status, notes, is_public_note)
    values (new.id, old.status, new.status, v_note, v_note is not null and v_public);
  end if;
  return null;
end;
$$;
