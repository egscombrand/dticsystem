-- =============================================================================
-- Kesepakatan waktu pengerjaan Pemohon ↔ PIC.
--
-- Tiga deadline yang TIDAK saling menimpa:
--   requested_deadline     : yang diminta Pemohon saat mengajukan — PERMANEN, tidak pernah diubah aplikasi.
--   pic_estimated_deadline : usulan/estimasi PIC terakhir.
--   agreed_deadline        : deadline final yang disepakati (hanya terisi setelah kesepakatan).
-- deadline_at tetap ada untuk kompatibilitas seluruh tampilan lama: sebelum sepakat = permintaan Pemohon,
-- setelah sepakat = agreed_deadline (disinkronkan di sini dan di aplikasi).
--
-- Status kesepakatan adalah dimensi TERPISAH dari orders.status (seperti SLA): orders.status tidak berubah.
-- SLA tahapan hanya berjalan setelah 'agreed'; sebelum itu stage_deadline_at = null (tidak bisa Auto-Closed).
-- Pengajuan lama (sebelum migrasi ini) dianggap sudah sepakat dengan deadline_at-nya.
-- Riwayat proses ada di order_deadline_events (hanya ditambah, tidak pernah diubah aplikasi).
-- =============================================================================

alter table public.orders add column if not exists requested_deadline timestamptz;
alter table public.orders add column if not exists pic_estimated_deadline timestamptz;
alter table public.orders add column if not exists agreed_deadline timestamptz;
alter table public.orders add column if not exists agreed_at timestamptz;
-- Default 'agreed' DULU supaya seluruh baris lama langsung bernilai 'agreed', lalu default diganti untuk baris baru.
alter table public.orders add column if not exists deadline_agreement_status text not null default 'agreed';
alter table public.orders drop constraint if exists orders_deadline_agreement_status_check;
alter table public.orders add constraint orders_deadline_agreement_status_check
  check (deadline_agreement_status in ('pic_review', 'awaiting_requester', 'adjustment_requested', 'agreed', 'escalated'));

update public.orders
set requested_deadline = coalesce(requested_deadline, deadline_at),
    agreed_deadline    = coalesce(agreed_deadline, deadline_at),
    agreed_at          = coalesce(agreed_at, created_at)
where deadline_agreement_status = 'agreed' and agreed_deadline is null;

alter table public.orders alter column deadline_agreement_status set default 'pic_review';

create index if not exists orders_deadline_agreement_pending_idx on public.orders (deadline_agreement_status)
  where deadline_agreement_status <> 'agreed';

create table if not exists public.order_deadline_events (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  kind              text not null check (kind in (
                      'pic_accepted_requested', 'pic_proposed', 'requester_approved', 'requester_adjustment_requested',
                      'escalated', 'manager_resolved', 'admin_changed', 'change_proposed', 'change_approved', 'change_rejected')),
  round             integer,
  proposed_deadline timestamptz,
  previous_deadline timestamptz,
  reason            text check (reason is null or char_length(reason) <= 1000),
  actor_user_id     uuid references public.app_users (id) on delete set null,
  actor_name        text,
  created_at        timestamptz not null default now()
);
create index if not exists order_deadline_events_order_idx on public.order_deadline_events (order_id, created_at);

alter table public.order_deadline_events enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.order_deadline_events from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.order_deadline_events from authenticated;
  end if;
end $$;

-- Deadline SLA tahapan: tidak ada SLA sebelum sepakat; aturan SLA spesifik bila ada; selain itu deadline sepakat.
create or replace function public.dtic_stage_deadline(
  p_status text, p_type_id uuid, p_started_at timestamptz, p_agreement text, p_agreed timestamptz
) returns timestamptz language plpgsql stable as $$
declare
  v_minutes integer;
begin
  if p_status in ('completed', 'cancelled') or p_agreement is distinct from 'agreed' then
    return null;
  end if;
  select duration_minutes into v_minutes from public.sla_rules
  where status = p_status and is_active and design_order_type_id = p_type_id;
  if v_minutes is null then
    select duration_minutes into v_minutes from public.sla_rules
    where status = p_status and is_active and design_order_type_id is null;
  end if;
  if v_minutes is not null then
    return p_started_at + make_interval(mins => v_minutes);
  end if;
  return p_agreed;
end;
$$;

create or replace function public.dtic_orders_before_update() returns trigger
language plpgsql as $$
begin
  new.id                 := old.id;
  new.order_number       := old.order_number;
  new.submission_key     := old.submission_key;
  new.created_at         := old.created_at;
  new.requested_deadline := old.requested_deadline; -- permintaan awal Pemohon tidak pernah berubah
  new.updated_at         := now();

  -- Deadline umum diubah (edit/Ubah tenggat) pada order yang sudah sepakat → itulah deadline sepakat yang baru.
  if new.deadline_at is distinct from old.deadline_at and new.deadline_agreement_status = 'agreed'
     and new.agreed_deadline is not distinct from old.agreed_deadline then
    new.agreed_deadline := new.deadline_at;
  end if;
  -- Deadline sepakat berubah → deadline umum (yang dipakai tampilan lama) mengikuti.
  if new.agreed_deadline is distinct from old.agreed_deadline and new.agreed_deadline is not null then
    new.deadline_at := new.agreed_deadline;
  end if;

  if new.status is distinct from old.status then
    if new.status in ('completed', 'closed') then
      new.completed_at := coalesce(old.completed_at, now());
    else
      new.completed_at := null;
    end if;
    new.stage_started_at := now();
    new.stage_deadline_at := public.dtic_stage_deadline(new.status, new.design_order_type_id, new.stage_started_at,
                                                        new.deadline_agreement_status, new.agreed_deadline);
  elsif new.deadline_agreement_status is distinct from old.deadline_agreement_status
        or new.agreed_deadline is distinct from old.agreed_deadline then
    -- Baru saja sepakat: SLA pengerjaan mulai SEKARANG (bukan sejak pengajuan dibuat).
    if new.deadline_agreement_status = 'agreed' and old.deadline_agreement_status is distinct from 'agreed' then
      new.stage_started_at := now();
    end if;
    new.stage_deadline_at := public.dtic_stage_deadline(new.status, new.design_order_type_id, new.stage_started_at,
                                                        new.deadline_agreement_status, new.agreed_deadline);
  end if;
  return new;
end;
$$;

create or replace function public.dtic_orders_before_insert() returns trigger
language plpgsql as $$
begin
  new.requested_deadline := coalesce(new.requested_deadline, new.deadline_at);
  new.stage_started_at := coalesce(new.stage_started_at, now());
  if new.deadline_agreement_status = 'agreed' then
    new.agreed_deadline := coalesce(new.agreed_deadline, new.deadline_at);
    new.agreed_at := coalesce(new.agreed_at, now());
  end if;
  if new.stage_deadline_at is null then
    new.stage_deadline_at := public.dtic_stage_deadline(new.status, new.design_order_type_id, new.stage_started_at,
                                                        new.deadline_agreement_status, new.agreed_deadline);
  end if;
  return new;
end;
$$;

drop trigger if exists dtic_orders_before_insert_trg on public.orders;
create trigger dtic_orders_before_insert_trg before insert on public.orders
  for each row execute function public.dtic_orders_before_insert();
