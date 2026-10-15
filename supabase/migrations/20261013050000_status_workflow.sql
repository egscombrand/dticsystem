-- =============================================================================
-- DTIC Connect — alur status pengerjaan baru + pelaku riwayat + notifikasi status
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF terhadap data: tidak ada baris yang dihapus. Riwayat status lama dipertahankan
-- apa adanya (kode lama tetap tersimpan di order_status_history).
--
-- Status baru (orders.status):
--   submitted            Pengajuan Masuk      (hanya data lama tanpa PIC)
--   assigned             Siap Dikerjakan      (status awal pengajuan baru; PIC dipilih pemohon)
--   in_progress          Sedang Dikerjakan
--   pending_confirmation Menunggu Konfirmasi
--   on_hold              Ditunda              (alasan wajib, dicatat di riwayat)
--   completed            Selesai
--   cancelled            Dibatalkan           (alasan wajib, dicatat di riwayat)
--
-- Pemetaan status lama → baru (berdasarkan arti, bukan sekadar nama):
--   new_request, queued  → assigned bila order sudah punya PIC; submitted bila belum
--   need_information     → on_hold              (menunggu informasi pemohon = pekerjaan tertahan)
--   in_progress          → in_progress
--   review               → pending_confirmation (hasil sedang ditinjau)
--   revision             → in_progress          (revisi sedang dikerjakan)
--   completed            → pending_confirmation (dulu: hasil diserahkan, belum ditutup)
--   closed               → completed            (dulu: order ditutup)
-- Setiap order yang statusnya dipetakan mendapat satu baris riwayat berisi catatan migrasi.
-- =============================================================================

-- 1. Pelaku perubahan status ------------------------------------------------------
alter table public.order_status_history
  add column if not exists changed_by uuid references public.app_users (id) on delete set null;

create or replace function public.dtic_orders_status_history() returns trigger
language plpgsql as $$
declare
  v_note   text    := nullif(current_setting('dtic.status_note', true), '');
  v_public boolean := coalesce(nullif(current_setting('dtic.status_note_public', true), '')::boolean, false);
  v_actor  uuid    := nullif(current_setting('dtic.actor_id', true), '')::uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (order_id, previous_status, new_status, notes, is_public_note, changed_by)
    values (new.id, null, new.status, coalesce(v_note, 'Order diajukan'), false, v_actor);
  elsif new.status is distinct from old.status then
    insert into public.order_status_history (order_id, previous_status, new_status, notes, is_public_note, changed_by)
    values (new.id, old.status, new.status, v_note, v_note is not null and v_public, v_actor);
  end if;
  return null;
end;
$$;

-- 2. completed_at hanya untuk status Selesai ----------------------------------------
create or replace function public.dtic_orders_before_update() returns trigger
language plpgsql as $$
begin
  new.id             := old.id;
  new.order_number   := old.order_number;
  new.submission_key := old.submission_key;
  new.created_at     := old.created_at;
  new.updated_at     := now();

  if new.status is distinct from old.status then
    if new.status = 'completed' then
      new.completed_at := coalesce(old.completed_at, now());
    else
      new.completed_at := null;
    end if;
  end if;
  return new;
end;
$$;

-- 3. Pemetaan status lama (SEKALI saja) ----------------------------------------------
-- Kode "completed" dipakai alur lama (hasil diserahkan) dan alur baru (selesai). Agar migrasi aman
-- dijalankan ulang, pemetaan hanya berjalan bila constraint status baru belum ada.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'orders_status_workflow_check' and conrelid = 'public.orders'::regclass) then
    return;
  end if;

  alter table public.orders drop constraint if exists orders_status_check;

  perform set_config('dtic.actor_id', '', true);
  perform set_config('dtic.status_note_public', 'false', true);

  -- Urutan penting: "completed" lama dipetakan SEBELUM "closed" menjadi "completed".
  perform set_config('dtic.status_note', 'Migrasi alur status: Completed lama (hasil diserahkan) → Menunggu Konfirmasi.', true);
  update public.orders set status = 'pending_confirmation' where status = 'completed';

  perform set_config('dtic.status_note', 'Migrasi alur status: Closed → Selesai.', true);
  update public.orders set status = 'completed' where status = 'closed';

  perform set_config('dtic.status_note', 'Migrasi alur status: PIC sudah ada → Siap Dikerjakan.', true);
  update public.orders o set status = 'assigned'
  where o.status in ('new_request', 'queued')
    and exists (select 1 from public.order_assignments a where a.order_id = o.id);

  perform set_config('dtic.status_note', 'Migrasi alur status: belum ada PIC → Pengajuan Masuk.', true);
  update public.orders set status = 'submitted' where status in ('new_request', 'queued');

  perform set_config('dtic.status_note', 'Migrasi alur status: Need Information → Ditunda (menunggu informasi pemohon).', true);
  update public.orders set status = 'on_hold' where status = 'need_information';

  perform set_config('dtic.status_note', 'Migrasi alur status: Review → Menunggu Konfirmasi.', true);
  update public.orders set status = 'pending_confirmation' where status = 'review';

  perform set_config('dtic.status_note', 'Migrasi alur status: Revision → Sedang Dikerjakan (revisi).', true);
  update public.orders set status = 'in_progress' where status = 'revision';

  perform set_config('dtic.status_note', '', true);

  alter table public.orders alter column status set default 'submitted';
  alter table public.orders add constraint orders_status_workflow_check
    check (status in ('submitted', 'assigned', 'in_progress', 'pending_confirmation', 'on_hold', 'completed', 'cancelled'));
end;
$$;

-- 4. Outbox: beberapa notifikasi per order (satu per peristiwa) -----------------------
alter table public.notification_outbox add column if not exists event_ref text not null default '';
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox drop constraint if exists notification_outbox_once;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_kind_v2_check' and conrelid = 'public.notification_outbox'::regclass) then
    alter table public.notification_outbox add constraint notification_outbox_kind_v2_check
      check (kind in ('order_created', 'status_changed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_event_once' and conrelid = 'public.notification_outbox'::regclass) then
    alter table public.notification_outbox add constraint notification_outbox_event_once
      unique (channel, kind, order_id, event_ref);
  end if;
end;
$$;
