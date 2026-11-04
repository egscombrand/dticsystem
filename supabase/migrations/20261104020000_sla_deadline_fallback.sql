-- =============================================================================
-- SLA: cadangan deadline + rekonsiliasi pengajuan lama.
--
-- Migrasi TERPISAH (bukan edit 20261104000000_sla_deadlines.sql) karena database yang sudah menjalankan
-- file itu tidak akan menjalankannya lagi (scripts/migrate.mjs mencatat per nama file). Tanpa migrasi ini,
-- database tersebut tetap memakai trigger lama (stage_deadline_at = null bila tidak ada sla_rules) sehingga
-- worker SLA tidak pernah menemukan order yang perlu ditutup. Seluruh isi aman dijalankan ulang (idempotent).
-- =============================================================================

-- 1. Trigger UPDATE: tanpa aturan SLA spesifik → stage_deadline_at = deadline_at (deadline yang tampil di layar).
create or replace function public.dtic_orders_before_update() returns trigger
language plpgsql as $$
declare
  v_minutes integer;
begin
  new.id             := old.id;
  new.order_number   := old.order_number;
  new.submission_key := old.submission_key;
  new.created_at     := old.created_at;
  new.updated_at     := now();

  if new.status is distinct from old.status then
    if new.status in ('completed', 'closed') then
      new.completed_at := coalesce(old.completed_at, now());
    else
      new.completed_at := null;
    end if;

    new.stage_started_at := now();
    if new.status in ('completed', 'cancelled') then
      new.stage_deadline_at := null;
    else
      select duration_minutes into v_minutes from public.sla_rules
      where status = new.status and is_active and design_order_type_id = new.design_order_type_id;
      if v_minutes is null then
        select duration_minutes into v_minutes from public.sla_rules
        where status = new.status and is_active and design_order_type_id is null;
      end if;
      new.stage_deadline_at := case when v_minutes is null then new.deadline_at else now() + make_interval(mins => v_minutes) end;
    end if;
  -- Deadline umum diubah (mis. Super Admin "Ubah tenggat") tanpa aturan SLA spesifik → ikut diperbarui,
  -- supaya deadline yang dipakai worker tetap sama dengan yang tampil di layar.
  elsif new.deadline_at is distinct from old.deadline_at and old.stage_deadline_at is not distinct from old.deadline_at then
    new.stage_deadline_at := new.deadline_at;
  end if;
  return new;
end;
$$;

-- 2. Trigger INSERT: sama, untuk pengajuan baru.
create or replace function public.dtic_orders_before_insert() returns trigger
language plpgsql as $$
declare
  v_minutes integer;
begin
  new.stage_started_at := coalesce(new.stage_started_at, now());
  if new.stage_deadline_at is null and new.status not in ('completed', 'cancelled') then
    select duration_minutes into v_minutes from public.sla_rules
    where status = new.status and is_active and design_order_type_id = new.design_order_type_id;
    if v_minutes is null then
      select duration_minutes into v_minutes from public.sla_rules
      where status = new.status and is_active and design_order_type_id is null;
    end if;
    new.stage_deadline_at := case when v_minutes is null then new.deadline_at else new.stage_started_at + make_interval(mins => v_minutes) end;
  end if;
  return new;
end;
$$;

drop trigger if exists dtic_orders_before_insert_trg on public.orders;
create trigger dtic_orders_before_insert_trg before insert on public.orders
  for each row execute function public.dtic_orders_before_insert();

-- 3. Jenis peristiwa SLA (ditegaskan ulang; versi awal file sebelumnya mungkin belum memuat 'sla_resumed').
alter table public.order_workflow_events drop constraint if exists order_workflow_events_kind_check;
alter table public.order_workflow_events add constraint order_workflow_events_kind_check
  check (kind in ('qc_submitted', 'qc_withdrawn', 'qc_approved', 'qc_revision_requested', 'qc_access_requested',
                   'delivery_recorded', 'feedback_recorded', 'completed', 'whatsapp_opened',
                   'sla_auto_closed', 'sla_resumed', 'sla_confirmed_complete'));

-- 4. Rekonsiliasi pengajuan lama: hanya yang belum selesai/dibatalkan dan belum punya stage_deadline_at.
update public.orders
set stage_deadline_at = deadline_at,
    stage_started_at = coalesce(stage_started_at, created_at)
where stage_deadline_at is null
  and status not in ('completed', 'cancelled');
