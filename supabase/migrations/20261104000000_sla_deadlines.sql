-- =============================================================================
-- SLA per tahapan status + penutupan otomatis saat deadline terlampaui.
-- NON-DESTRUKTIF: tidak ada baris/kolom yang dihapus, tidak ada status lama yang dipetakan ulang.
--
-- PENTING — status SLA TERPISAH dari status pekerjaan (jangan dicampur, lihat src/lib/sla.ts):
--   orders.status TETAP memakai nilai yang sudah ada (submitted/assigned/.../completed/cancelled), TIDAK
--   ADA nilai baru. "Ditutup otomatis karena SLA" bukan nilai status, melainkan penanda terpisah
--   (orders.sla_closed_at, timestamptz, permanen — tidak pernah dihapus/ditimpa). PIC tetap memegang status
--   pekerjaan apa adanya dan tetap bisa melanjutkannya lewat jalur status biasa; closeOrderBySla (lihat
--   repositories/orders.ts) TIDAK PERNAH menyentuh kolom status.
-- =============================================================================

-- 1. Pelacakan SLA tahapan aktif per order --------------------------------------------
-- stage_started_at : kapan status SAAT INI mulai berlaku (diisi ulang setiap kali status berubah).
-- stage_deadline_at: deadline tahapan SAAT INI. Dihitung dari sla_rules yang cocok (jenis pengajuan + status)
--                    bila ADA aturan; bila TIDAK ADA aturan, memakai deadline_at (deadline umum yang sudah
--                    ditetapkan Pemohon saat pengajuan dan DITAMPILKAN di layar) sebagai cadangan — supaya
--                    deadline yang dipakai worker SELALU sama dengan yang ditampilkan ke pengguna, tidak
--                    pernah diam-diam null/tidak pernah diperiksa hanya karena belum ada aturan SLA spesifik.
-- sla_closed_at    : kapan sistem menutup otomatis karena SLA terlampaui. null = belum pernah. PERMANEN —
--                    tidak pernah dihapus, termasuk setelah "Lanjutkan Pekerjaan" atau konfirmasi selesai
--                    (riwayat keterlambatan harus tetap terlihat, lihat spesifikasi bagian 4 & 6).
alter table public.orders add column if not exists stage_started_at timestamptz;
alter table public.orders add column if not exists stage_deadline_at timestamptz;
alter table public.orders add column if not exists sla_closed_at timestamptz;
-- Indeks parsial: hanya order dengan SLA aktif, belum ditutup karena SLA, & belum berstatus akhir yang
-- perlu diperiksa worker (lihat dueOrderIds di sla-worker.ts).
create index if not exists orders_stage_deadline_due_idx on public.orders (stage_deadline_at)
  where stage_deadline_at is not null and sla_closed_at is null and status not in ('completed', 'cancelled');

-- 2. Konfigurasi SLA (dikelola Admin/Super Admin) -------------------------------------
-- design_order_type_id null = aturan default untuk SEMUA jenis pengajuan pada status tsb (dipakai bila
-- tidak ada aturan khusus jenis itu). Satu baris per (jenis pengajuan, status); satu baris default per status.
create table if not exists public.sla_rules (
  id                     uuid primary key default gen_random_uuid(),
  design_order_type_id   uuid references public.design_order_types (id) on update cascade on delete cascade,
  status                 text not null check (status in ('submitted', 'assigned', 'in_progress', 'pending_confirmation',
                                                           'internal_revision', 'awaiting_requester', 'on_hold')),
  duration_minutes       integer not null check (duration_minutes > 0),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index if not exists sla_rules_type_status_uq on public.sla_rules (design_order_type_id, status) where design_order_type_id is not null;
create unique index if not exists sla_rules_default_status_uq on public.sla_rules (status) where design_order_type_id is null;

alter table public.sla_rules enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.sla_rules from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.sla_rules from authenticated;
  end if;
end $$;

-- 3. Hitung ulang stage_started_at/stage_deadline_at pada SETIAP perubahan status -----
-- Diletakkan di trigger (bukan di satu fungsi repository saja) supaya konsisten untuk SEMUA jalur perubahan
-- status yang sudah ada (changeOrderStatus maupun alur QC applyWorkflowAction) tanpa mengubah fungsi-fungsi
-- itu satu per satu. closeOrderBySla TIDAK mengubah status sama sekali, jadi trigger ini TIDAK ikut berjalan
-- saat SLA menutup order — hanya saat status pekerjaan SUNGGUHAN berubah (termasuk closed_sla → completed
-- lewat konfirmasi PIC, yang memang transisi status sungguhan).
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
    -- 'closed' = kode status LAMA (lihat 20261013050000_status_workflow.sql) yang sudah dipetakan permanen
    -- ke 'completed' dan tidak lagi diizinkan oleh constraint status — cabang ini tidak pernah tercapai
    -- pada data baru, dipertahankan hanya untuk kesamaan dengan definisi fungsi aslinya (tidak berbahaya).
    if new.status in ('completed', 'closed') then
      new.completed_at := coalesce(old.completed_at, now());
    else
      new.completed_at := null;
    end if;

    new.stage_started_at := now();
    if new.status in ('completed', 'cancelled') then
      new.stage_deadline_at := null; -- status akhir: tidak ada SLA tahapan berikutnya
    else
      select duration_minutes into v_minutes from public.sla_rules
      where status = new.status and is_active and design_order_type_id = new.design_order_type_id;
      if v_minutes is null then
        select duration_minutes into v_minutes from public.sla_rules
        where status = new.status and is_active and design_order_type_id is null;
      end if;
      -- Tidak ada aturan SLA spesifik → cadangan: deadline_at (deadline umum, sama dengan yang tampil di layar).
      new.stage_deadline_at := case when v_minutes is null then new.deadline_at else now() + make_interval(mins => v_minutes) end;
    end if;
  end if;
  return new;
end;
$$;

-- Order baru juga mendapat stage_started_at/deadline untuk status awalnya (trigger INSERT terpisah dari
-- trigger UPDATE yang sudah ada agar tidak mengubah perilaku INSERT yang sudah berjalan).
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
    -- Tidak ada aturan SLA spesifik → cadangan: deadline_at (deadline umum, sama dengan yang tampil di layar).
    new.stage_deadline_at := case when v_minutes is null then new.deadline_at else new.stage_started_at + make_interval(mins => v_minutes) end;
  end if;
  return new;
end;
$$;

drop trigger if exists dtic_orders_before_insert_trg on public.orders;
create trigger dtic_orders_before_insert_trg before insert on public.orders
  for each row execute function public.dtic_orders_before_insert();

-- 4. Catatan peristiwa SLA (auto-close, lanjutkan pekerjaan, konfirmasi PIC) ----------
alter table public.order_workflow_events drop constraint if exists order_workflow_events_kind_check;
alter table public.order_workflow_events add constraint order_workflow_events_kind_check
  check (kind in ('qc_submitted', 'qc_withdrawn', 'qc_approved', 'qc_revision_requested', 'qc_access_requested',
                   'delivery_recorded', 'feedback_recorded', 'completed', 'whatsapp_opened',
                   'sla_auto_closed', 'sla_resumed', 'sla_confirmed_complete'));

-- 5. Menu sidebar "SLA & Deadline Otomatis" (Super Admin, sub-halaman Pengaturan) ------
-- allowed_roles di sini HANYA mengatur tampilan menu, bukan satu-satunya pengaman — halaman itu sendiri
-- tetap memeriksa master.manage di server (lihat src/app/dtic/(panel)/settings/sla/page.tsx).
insert into public.sidebar_menu_items (key, parent_key, label, href, icon, required_capability, allowed_roles, is_core, sort_order) values
  ('sla', 'settings', 'SLA & Deadline Otomatis', '/dtic/settings/sla', 'history', 'master.manage', array['super_admin'], false, 76)
on conflict (key) do nothing;

-- 6. Rekonsiliasi SEKALI untuk pengajuan LAMA (sudah ada sebelum fitur ini) yang belum pernah mendapat
--    stage_deadline_at (trigger di atas hanya berjalan untuk baris BARU/baris yang statusnya berubah
--    SETELAH migrasi ini). Idempotent: hanya mengisi baris yang stage_deadline_at-nya masih null (dijalankan
--    ulang = tidak melakukan apa-apa pada baris yang sudah terisi), dan TIDAK PERNAH menyentuh order yang
--    sudah Selesai/Dibatalkan (status akhir tidak relevan untuk SLA).
update public.orders
set stage_deadline_at = deadline_at,
    stage_started_at = coalesce(stage_started_at, created_at)
where stage_deadline_at is null
  and status not in ('completed', 'cancelled');
