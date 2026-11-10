-- =============================================================================
-- Order Collaboration (sisi Pemohon dulu): diskusi dengan PIC, brief read-only + usulan perubahan berversi,
-- unggahan referensi tambahan, dan status baca untuk badge notifikasi.
--
-- Prinsip:
--  * Semua akses lewat server (RLS aktif, anon/authenticated dicabut) — sama seperti tabel lain. Tidak ada Firebase.
--  * Riwayat hanya ditambah: pesan, lampiran pesan, versi brief, dan isi usulan perubahan tidak bisa diubah/dihapus
--    langsung (trigger). Penghapusan berantai karena order dihapus tetap berjalan (pg_trigger_depth).
--  * Tabel dirancang dipakai dua arah (Pemohon sekarang, PIC/Manager/Admin nanti): sender_kind & reader_kind.
--  * Tidak mengubah alur QC/persetujuan yang ada.
-- Memakai fungsi pengaman dari migrasi Review Center: review_block_direct_delete() dan review_immutable_row().
-- =============================================================================

-- 1. Pesan diskusi (satu ruang per order) -----------------------------------------------
create table if not exists public.order_messages (
  id             uuid primary key default gen_random_uuid(),
  seq            bigint generated always as identity,
  order_id       uuid not null references public.orders (id) on delete cascade,
  sender_kind    text not null check (sender_kind in ('requester', 'staff', 'manager', 'super_admin', 'system')),
  sender_name    text not null check (char_length(btrim(sender_name)) between 1 and 160),
  sender_user_id uuid references public.app_users (id) on delete set null,
  body           text not null default '' check (char_length(body) <= 2000),
  request_key    uuid,
  created_at     timestamptz not null default now(),
  constraint order_messages_seq_key unique (seq)
);
create unique index if not exists order_messages_request_key_uq on public.order_messages (order_id, request_key) where request_key is not null;
create index if not exists order_messages_order_seq_idx on public.order_messages (order_id, seq);

create table if not exists public.order_message_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.order_messages (id) on delete cascade,
  order_id     uuid not null references public.orders (id) on delete cascade,
  file_name    text not null check (char_length(file_name) between 1 and 255),
  storage_path text not null check (char_length(storage_path) between 1 and 512),
  mime_type    text not null check (char_length(mime_type) between 1 and 127),
  file_size    bigint not null check (file_size > 0),
  created_at   timestamptz not null default now(),
  constraint order_message_attachments_path_key unique (storage_path)
);
create index if not exists order_message_attachments_message_idx on public.order_message_attachments (message_id);
create index if not exists order_message_attachments_order_idx on public.order_message_attachments (order_id);

-- 2. Status baca (badge "pesan belum dibaca" / "hasil baru") ---------------------------
-- reader_key = '' untuk Pemohon (anonim, satu pembaca logis per order); id akun untuk pembaca internal nanti.
create table if not exists public.order_read_state (
  order_id        uuid not null references public.orders (id) on delete cascade,
  reader_kind     text not null check (reader_kind in ('requester', 'staff', 'manager', 'super_admin')),
  reader_key      text not null default '',
  last_read_seq   bigint not null default 0,
  results_seen_at timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (order_id, reader_kind, reader_key)
);

-- 3. Brief berversi + usulan perubahan dari Pemohon -------------------------------------
create table if not exists public.order_brief_versions (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  version_no        integer not null check (version_no >= 1),
  brief             text not null,
  brief_rich        jsonb,
  source            text not null check (source in ('original', 'requester_change', 'staff_edit')),
  change_request_id uuid,
  created_by_name   text not null,
  created_at        timestamptz not null default now(),
  unique (order_id, version_no)
);

create table if not exists public.order_brief_change_requests (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete cascade,
  based_on_version     integer not null check (based_on_version >= 1),
  proposed_brief       text not null check (char_length(btrim(proposed_brief)) between 10 and 5000),
  proposed_brief_rich  jsonb,
  reason               text not null check (char_length(btrim(reason)) between 3 and 1000),
  requested_by_name    text not null,
  status               text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  decided_by_name      text,
  decided_by_user_id   uuid references public.app_users (id) on delete set null,
  decided_at           timestamptz,
  decision_note        text check (decision_note is null or char_length(decision_note) <= 1000),
  resulting_version_no integer,
  request_key          uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- Satu usulan menunggu per order: mencegah banjir usulan; Pemohon menarik yang lama bila ingin mengganti.
create unique index if not exists order_brief_change_one_pending_uq on public.order_brief_change_requests (order_id) where status = 'pending';
create unique index if not exists order_brief_change_request_key_uq on public.order_brief_change_requests (order_id, request_key) where request_key is not null;
create index if not exists order_brief_change_order_idx on public.order_brief_change_requests (order_id, created_at);

-- Snapshot otomatis: versi 1 saat order dibuat; versi baru setiap kali brief berubah (lewat jalur mana pun).
-- Pelaku/sumber dibaca dari pengaturan transaksi (set_config(..., true)) bila ada; bila tidak = edit tim DTIC.
create or replace function public.order_brief_snapshot() returns trigger
language plpgsql as $$
declare
  v_next integer;
begin
  if tg_op = 'INSERT' then
    insert into public.order_brief_versions (order_id, version_no, brief, brief_rich, source, created_by_name)
    values (new.id, 1, new.brief, new.brief_rich, 'original', coalesce(nullif(new.requester_name, ''), 'Pemohon'));
    return null;
  end if;
  if new.brief is distinct from old.brief or new.brief_rich is distinct from old.brief_rich then
    select coalesce(max(version_no), 0) + 1 into v_next from public.order_brief_versions where order_id = new.id;
    insert into public.order_brief_versions (order_id, version_no, brief, brief_rich, source, change_request_id, created_by_name)
    values (
      new.id, v_next, new.brief, new.brief_rich,
      coalesce(nullif(current_setting('dtic.brief_source', true), ''), 'staff_edit'),
      nullif(current_setting('dtic.brief_change_id', true), '')::uuid,
      coalesce(nullif(current_setting('dtic.brief_actor', true), ''), 'Tim DTIC')
    );
  end if;
  return null;
end;
$$;

drop trigger if exists order_brief_snapshot_ins_trg on public.orders;
create trigger order_brief_snapshot_ins_trg after insert on public.orders
  for each row execute function public.order_brief_snapshot();
drop trigger if exists order_brief_snapshot_upd_trg on public.orders;
create trigger order_brief_snapshot_upd_trg after update of brief, brief_rich on public.orders
  for each row execute function public.order_brief_snapshot();

-- Versi 1 untuk order yang sudah ada (isi brief SAAT INI; bila pernah diedit internal sebelumnya, versi aslinya
-- sudah tidak dapat dipulihkan — itu keterbatasan data lama, bukan kehilangan data baru).
insert into public.order_brief_versions (order_id, version_no, brief, brief_rich, source, created_by_name, created_at)
select o.id, 1, o.brief, o.brief_rich, 'original', coalesce(nullif(o.requester_name, ''), 'Pemohon'), o.created_at
from public.orders o
where not exists (select 1 from public.order_brief_versions v where v.order_id = o.id);

-- 4. Pengaman riwayat (hanya ditambah) -------------------------------------------------
-- Pesan: satu-satunya perubahan yang diizinkan adalah sender_user_id → null (akibat ON DELETE SET NULL).
create or replace function public.order_messages_guard() returns trigger
language plpgsql as $$
begin
  if to_jsonb(new) - 'sender_user_id' is distinct from to_jsonb(old) - 'sender_user_id' or new.sender_user_id is not null then
    raise exception 'Pesan diskusi bersifat tetap (hanya ditambah) dan tidak boleh diubah.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Usulan perubahan brief: isi usulan tetap; hanya status/keputusan yang boleh berubah, dan hanya dari 'pending'.
create or replace function public.order_brief_change_guard() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id or new.order_id is distinct from old.order_id
     or new.based_on_version is distinct from old.based_on_version
     or new.proposed_brief is distinct from old.proposed_brief or new.proposed_brief_rich is distinct from old.proposed_brief_rich
     or new.reason is distinct from old.reason or new.requested_by_name is distinct from old.requested_by_name
     or new.created_at is distinct from old.created_at then
    raise exception 'Isi usulan perubahan brief tidak boleh diubah; hanya statusnya.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and old.status <> 'pending' then
    raise exception 'Usulan yang sudah diputuskan tidak dapat diubah lagi.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists order_messages_guard_trg on public.order_messages;
create trigger order_messages_guard_trg before update on public.order_messages
  for each row execute function public.order_messages_guard();
drop trigger if exists order_messages_nodelete_trg on public.order_messages;
create trigger order_messages_nodelete_trg before delete on public.order_messages
  for each row execute function public.review_block_direct_delete();

drop trigger if exists order_message_attachments_immutable_trg on public.order_message_attachments;
create trigger order_message_attachments_immutable_trg before update on public.order_message_attachments
  for each row execute function public.review_immutable_row();
drop trigger if exists order_message_attachments_nodelete_trg on public.order_message_attachments;
create trigger order_message_attachments_nodelete_trg before delete on public.order_message_attachments
  for each row execute function public.review_block_direct_delete();

drop trigger if exists order_brief_versions_immutable_trg on public.order_brief_versions;
create trigger order_brief_versions_immutable_trg before update on public.order_brief_versions
  for each row execute function public.review_immutable_row();
drop trigger if exists order_brief_versions_nodelete_trg on public.order_brief_versions;
create trigger order_brief_versions_nodelete_trg before delete on public.order_brief_versions
  for each row execute function public.review_block_direct_delete();

drop trigger if exists order_brief_change_guard_trg on public.order_brief_change_requests;
create trigger order_brief_change_guard_trg before update on public.order_brief_change_requests
  for each row execute function public.order_brief_change_guard();
drop trigger if exists order_brief_change_nodelete_trg on public.order_brief_change_requests;
create trigger order_brief_change_nodelete_trg before delete on public.order_brief_change_requests
  for each row execute function public.review_block_direct_delete();

-- 5. Referensi tambahan dari Pemohon setelah pengajuan ---------------------------------
-- Memakai order_attachments (kind = 'reference') yang SUDAH dilihat PIC di daftar lampiran order.
alter table public.order_attachments add column if not exists added_after_submission boolean not null default false;
alter table public.order_attachments add column if not exists uploaded_by_name text;

-- 6. Akses hanya lewat server ----------------------------------------------------------
alter table public.order_messages enable row level security;
alter table public.order_message_attachments enable row level security;
alter table public.order_read_state enable row level security;
alter table public.order_brief_versions enable row level security;
alter table public.order_brief_change_requests enable row level security;
do $$
declare t text;
begin
  foreach t in array array['order_messages', 'order_message_attachments', 'order_read_state', 'order_brief_versions', 'order_brief_change_requests'] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on public.%I from authenticated', t);
    end if;
  end loop;
end $$;

-- 7. Jenis peristiwa baru di riwayat order ----------------------------------------------
alter table public.order_workflow_events drop constraint if exists order_workflow_events_kind_check;
alter table public.order_workflow_events add constraint order_workflow_events_kind_check
  check (kind in ('qc_submitted', 'qc_withdrawn', 'qc_approved', 'qc_revision_requested', 'qc_access_requested',
                   'delivery_recorded', 'feedback_recorded', 'completed', 'whatsapp_opened',
                   'sla_auto_closed', 'sla_resumed', 'sla_confirmed_complete',
                   'review_highlight_added', 'review_comment_added', 'review_clarification_requested', 'review_clarification_answered',
                   'revision_created', 'revision_started', 'revision_delivered', 'revision_approved', 'revision_resubmitted',
                   'reference_uploaded', 'brief_change_requested', 'brief_change_accepted', 'brief_change_rejected', 'brief_change_withdrawn'));
