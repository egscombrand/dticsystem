-- =============================================================================
-- Penyerahan hasil, QC Manager, dan komunikasi pemohon.
-- NON-DESTRUKTIF: tidak ada baris yang dihapus; riwayat status & audit tetap.
--
-- Tanpa "mode kebijakan QC": PIC memilih tujuan penyerahan setiap kali (Manager atau langsung ke pemohon).
-- Tiga hal dipisahkan:
--   - status pekerjaan  : orders.status (dua status baru di bawah)
--   - status QC         : orders.qc_status (none | pending | approved | revision) — hanya berubah oleh peristiwa QC
--   - status pengiriman : diturunkan dari peristiwa 'delivery_recorded' (tidak disimpan ganda)
--
-- 1. Status baru: internal_revision (Perlu Revisi Internal), awaiting_requester (Menunggu Masukan Pemohon).
--    'pending_confirmation' dipertahankan; maknanya sejak awal "hasil menunggu pemeriksaan internal"
--    (dulu dikonfirmasi Super Admin), kini ditampilkan "Menunggu QC Manager". Pekerjaan lama berstatus ini
--    diberi qc_status = 'pending' (maknanya diketahui pasti); statusnya TIDAK diubah.
-- 2. order_workflow_events: jejak QC, pengiriman, masukan pemohon, penyelesaian, dan 'whatsapp_opened'
--    (PIC membuka WhatsApp dengan pesan yang disiapkan; BUKAN bukti terkirim, isi pesan tidak disimpan).
--    request_key unik per pekerjaan agar retry/klik ganda tidak menggandakan peristiwa.
-- 3. File hasil pekerjaan memakai tabel & bucket lampiran yang sama (order_attachments, penyimpanan privat),
--    dibedakan dengan kind: 'reference' (dokumen pemohon, semua data lama) | 'result' (hasil buatan PIC).
--    uploaded_by = pengunggah; upload_key unik per order agar upload ulang setelah timeout tidak menggandakan file.
--    Keterkaitan file dengan pengajuan QC/pengiriman/penyelesaian disimpan di order_workflow_events.detail.resultFileIds.
-- Rollback: constraint status lama dapat dipasang kembali setelah baris berstatus baru dipindahkan;
-- kolom/tabel baru boleh dibiarkan.
-- =============================================================================

alter table public.orders add column if not exists qc_status text not null default 'none';
alter table public.orders drop constraint if exists orders_qc_status_check;
alter table public.orders add constraint orders_qc_status_check check (qc_status in ('none', 'pending', 'approved', 'revision'));

alter table public.orders drop constraint if exists orders_status_workflow_check;
alter table public.orders add constraint orders_status_workflow_check
  check (status in ('submitted', 'assigned', 'in_progress', 'pending_confirmation', 'internal_revision', 'awaiting_requester', 'on_hold', 'completed', 'cancelled'));

-- Data lama: pending_confirmation = hasil diserahkan ke internal dan menunggu pemeriksaan.
update public.orders set qc_status = 'pending' where status = 'pending_confirmation' and qc_status = 'none';

create table if not exists public.order_workflow_events (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders (id) on delete cascade,
  kind           text not null,
  actor_user_id  uuid references public.app_users (id) on delete set null,
  actor_name     text,
  stage          text check (stage is null or stage in ('draft', 'revision', 'final')),
  link           text,
  summary        text,
  needs_revision boolean,
  detail         jsonb not null default '{}'::jsonb,
  request_key    uuid,
  created_at     timestamptz not null default now()
);
-- CREATE TABLE IF NOT EXISTS tidak menyentuh constraint pada tabel yang sudah ada (mis. dari draf migrasi
-- ini yang lebih awal sempat dijalankan langsung di produksi dengan daftar kind lama: 'qc_policy_changed',
-- 'completed_override', tanpa 'qc_withdrawn'/'qc_access_requested'/'completed'/'whatsapp_opened'). Baris di
-- bawah SELALU menyamakan constraint dengan kind yang dipakai kode saat ini, terlepas dari draf mana yang
-- lebih dulu berjalan di database tujuan.
alter table public.order_workflow_events drop constraint if exists order_workflow_events_kind_check;
alter table public.order_workflow_events add constraint order_workflow_events_kind_check
  check (kind in ('qc_submitted', 'qc_withdrawn', 'qc_approved', 'qc_revision_requested', 'qc_access_requested',
                   'delivery_recorded', 'feedback_recorded', 'completed', 'whatsapp_opened'));
create index if not exists order_workflow_events_order_idx on public.order_workflow_events (order_id, created_at desc);
create unique index if not exists order_workflow_events_request_key_idx
  on public.order_workflow_events (order_id, request_key) where request_key is not null;

alter table public.order_workflow_events enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.order_workflow_events from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.order_workflow_events from authenticated;
  end if;
end $$;

-- 3. File hasil pekerjaan -------------------------------------------------------------
alter table public.order_attachments
  add column if not exists kind text not null default 'reference',
  add column if not exists uploaded_by uuid references public.app_users (id) on delete set null,
  add column if not exists upload_key uuid;
alter table public.order_attachments drop constraint if exists order_attachments_kind_check;
alter table public.order_attachments add constraint order_attachments_kind_check check (kind in ('reference', 'result'));
create unique index if not exists order_attachments_upload_key_idx
  on public.order_attachments (order_id, upload_key) where upload_key is not null;
