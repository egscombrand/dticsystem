-- =============================================================================
-- Review Center: highlight + komentar pada hasil pekerjaan, Request Revisi (REV-NNN), dan penelusuran versi.
--
-- Prinsip:
--  * TIDAK ada sistem QC baru: status pekerjaan (orders.status) & QC (orders.qc_status) tidak diubah di sini.
--    Request Revisi memakai aksi workflow 'record_feedback' yang SUDAH ada (lihat applyWorkflowAction).
--  * "Versi dokumen" = satu pengiriman hasil ke pemohon (order_workflow_events.kind = 'delivery_recorded').
--    File hasil tidak pernah ditimpa; versi baru = pengiriman baru. Berkas TIDAK disalin ke tabel baru.
--  * Status highlight, status Request Revisi, dan status pekerjaan adalah TIGA dimensi terpisah.
--  * Riwayat (highlight, komentar, item revisi) hanya ditambah: UPDATE kolom identitas/isi dan DELETE
--    langsung ditolak trigger. Penghapusan berantai karena order dihapus tetap berjalan (pg_trigger_depth).
--  * Koordinat disimpan ternormalisasi (0–1 terhadap ukuran halaman/gambar), bukan piksel, supaya tetap
--    akurat saat zoom, ganti ukuran layar, atau dibuka ulang.
-- =============================================================================

-- 1. Highlight ------------------------------------------------------------------------
create table if not exists public.review_annotations (
  id                          uuid primary key default gen_random_uuid(),
  order_id                    uuid not null references public.orders (id) on delete cascade,
  number                      integer not null check (number >= 1),
  delivery_id                 uuid not null references public.order_workflow_events (id) on delete cascade,
  version_no                  integer not null check (version_no >= 1),
  attachment_id               uuid references public.order_attachments (id) on delete cascade,
  link_id                     uuid references public.order_result_links (id) on delete cascade,
  kind                        text not null check (kind in ('area', 'text', 'manual')),
  page                        integer check (page is null or page between 1 and 10000),
  geometry                    jsonb,
  quote                       text check (quote is null or char_length(quote) <= 600),
  reference                   text check (reference is null or char_length(reference) <= 300),
  status                      text not null default 'not_submitted'
                                check (status in ('not_submitted', 'waiting_pic', 'waiting_clarification', 'in_progress', 'waiting_check', 'done')),
  status_before_clarification text,
  created_by_kind             text not null check (created_by_kind in ('requester', 'staff', 'manager', 'super_admin')),
  created_by_name             text not null,
  created_by_user_id          uuid references public.app_users (id) on delete set null,
  request_key                 uuid,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint review_annotations_one_target check ((attachment_id is not null)::int + (link_id is not null)::int = 1),
  constraint review_annotations_geometry_ok check (
    (kind in ('area', 'text') and geometry is not null and page is not null)
    or (kind = 'manual' and reference is not null)
  ),
  unique (order_id, number)
);
create unique index if not exists review_annotations_request_key_uq on public.review_annotations (order_id, request_key) where request_key is not null;
create index if not exists review_annotations_order_idx on public.review_annotations (order_id, number);
create index if not exists review_annotations_delivery_idx on public.review_annotations (delivery_id);

-- 2. Komentar (satu thread per highlight; hanya ditambah) -----------------------------
create table if not exists public.review_comments (
  id             uuid primary key default gen_random_uuid(),
  annotation_id  uuid not null references public.review_annotations (id) on delete cascade,
  order_id       uuid not null references public.orders (id) on delete cascade,
  body           text not null check (char_length(body) between 1 and 2000),
  kind           text not null default 'comment' check (kind in ('comment', 'clarification_request', 'clarification_answer')),
  author_kind    text not null check (author_kind in ('requester', 'staff', 'manager', 'super_admin')),
  author_name    text not null,
  author_user_id uuid references public.app_users (id) on delete set null,
  request_key    uuid,
  created_at     timestamptz not null default now()
);
create unique index if not exists review_comments_request_key_uq on public.review_comments (order_id, request_key) where request_key is not null;
create index if not exists review_comments_annotation_idx on public.review_comments (annotation_id, created_at);

-- 3. Request Revisi (REV-001, REV-002, … berurutan per order) -------------------------
create table if not exists public.revision_requests (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders (id) on delete cascade,
  number                integer not null check (number >= 1),
  reviewed_delivery_id  uuid not null references public.order_workflow_events (id) on delete cascade,
  reviewed_version_no   integer not null check (reviewed_version_no >= 1),
  status                text not null default 'waiting_pic'
                          check (status in ('draft', 'waiting_pic', 'in_progress', 'waiting_requester_check', 'approved', 'resubmitted')),
  note                  text check (note is null or char_length(note) <= 1000),
  requested_by_name     text not null,
  feedback_event_id     uuid references public.order_workflow_events (id) on delete set null,
  delivered_delivery_id uuid references public.order_workflow_events (id) on delete set null,
  delivered_version_no  integer,
  started_by_name       text,
  started_at            timestamptz,
  approved_by_name      text,
  approved_at           timestamptz,
  resubmitted_at        timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (order_id, number)
);
create index if not exists revision_requests_order_idx on public.revision_requests (order_id, number);

create table if not exists public.revision_request_items (
  id            uuid primary key default gen_random_uuid(),
  revision_id   uuid not null references public.revision_requests (id) on delete cascade,
  annotation_id uuid not null references public.review_annotations (id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (revision_id, annotation_id)
);
create index if not exists revision_request_items_annotation_idx on public.revision_request_items (annotation_id);

-- 4. Pengaman riwayat ------------------------------------------------------------------
-- DELETE langsung (depth 1) ditolak; penghapusan berantai dari order (dipicu trigger RI, depth >= 2) diizinkan.
create or replace function public.review_block_direct_delete() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() < 2 then
    raise exception 'Riwayat Review Center tidak boleh dihapus (%).', tg_table_name using errcode = '42501';
  end if;
  return old;
end;
$$;

create or replace function public.review_annotations_guard() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id or new.order_id is distinct from old.order_id or new.number is distinct from old.number
     or new.delivery_id is distinct from old.delivery_id or new.version_no is distinct from old.version_no
     or new.attachment_id is distinct from old.attachment_id or new.link_id is distinct from old.link_id
     or new.kind is distinct from old.kind or new.page is distinct from old.page or new.geometry is distinct from old.geometry
     or new.quote is distinct from old.quote or new.reference is distinct from old.reference
     or new.created_by_kind is distinct from old.created_by_kind or new.created_by_name is distinct from old.created_by_name
     or (new.created_by_user_id is distinct from old.created_by_user_id and new.created_by_user_id is not null)
     or new.created_at is distinct from old.created_at then
    raise exception 'Isi dan posisi highlight tidak boleh diubah; hanya statusnya.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.review_immutable_row() returns trigger
language plpgsql as $$
begin
  raise exception 'Baris % bersifat tetap (hanya ditambah) dan tidak boleh diubah.', tg_table_name using errcode = '42501';
end;
$$;

-- Komentar: satu-satunya perubahan yang diizinkan adalah author_user_id → null (akibat ON DELETE SET NULL
-- bila akun dihapus); nama pengirim tetap tersimpan di author_name.
create or replace function public.review_comments_guard() returns trigger
language plpgsql as $$
begin
  if to_jsonb(new) - 'author_user_id' is distinct from to_jsonb(old) - 'author_user_id' or new.author_user_id is not null then
    raise exception 'Komentar bersifat tetap (hanya ditambah) dan tidak boleh diubah.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.revision_requests_guard() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id or new.order_id is distinct from old.order_id or new.number is distinct from old.number
     or new.reviewed_delivery_id is distinct from old.reviewed_delivery_id or new.reviewed_version_no is distinct from old.reviewed_version_no
     or new.note is distinct from old.note or new.requested_by_name is distinct from old.requested_by_name
     or new.created_at is distinct from old.created_at then
    raise exception 'Isi Request Revisi tidak boleh diubah; hanya statusnya.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists review_annotations_guard_trg on public.review_annotations;
create trigger review_annotations_guard_trg before update on public.review_annotations
  for each row execute function public.review_annotations_guard();
drop trigger if exists review_annotations_nodelete_trg on public.review_annotations;
create trigger review_annotations_nodelete_trg before delete on public.review_annotations
  for each row execute function public.review_block_direct_delete();

drop trigger if exists review_comments_immutable_trg on public.review_comments;
create trigger review_comments_immutable_trg before update on public.review_comments
  for each row execute function public.review_comments_guard();
drop trigger if exists review_comments_nodelete_trg on public.review_comments;
create trigger review_comments_nodelete_trg before delete on public.review_comments
  for each row execute function public.review_block_direct_delete();

drop trigger if exists revision_requests_guard_trg on public.revision_requests;
create trigger revision_requests_guard_trg before update on public.revision_requests
  for each row execute function public.revision_requests_guard();
drop trigger if exists revision_requests_nodelete_trg on public.revision_requests;
create trigger revision_requests_nodelete_trg before delete on public.revision_requests
  for each row execute function public.review_block_direct_delete();

drop trigger if exists revision_request_items_immutable_trg on public.revision_request_items;
create trigger revision_request_items_immutable_trg before update on public.revision_request_items
  for each row execute function public.review_immutable_row();
drop trigger if exists revision_request_items_nodelete_trg on public.revision_request_items;
create trigger revision_request_items_nodelete_trg before delete on public.revision_request_items
  for each row execute function public.review_block_direct_delete();

-- 5. Akses hanya lewat server (sama seperti tabel lain) -------------------------------
alter table public.review_annotations enable row level security;
alter table public.review_comments enable row level security;
alter table public.revision_requests enable row level security;
alter table public.revision_request_items enable row level security;
do $$
declare t text;
begin
  foreach t in array array['review_annotations', 'review_comments', 'revision_requests', 'revision_request_items'] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on public.%I from authenticated', t);
    end if;
  end loop;
end $$;

-- 6. Jenis peristiwa baru di riwayat order (Riwayat Request / ActivityTimeline) ---------
alter table public.order_workflow_events drop constraint if exists order_workflow_events_kind_check;
alter table public.order_workflow_events add constraint order_workflow_events_kind_check
  check (kind in ('qc_submitted', 'qc_withdrawn', 'qc_approved', 'qc_revision_requested', 'qc_access_requested',
                   'delivery_recorded', 'feedback_recorded', 'completed', 'whatsapp_opened',
                   'sla_auto_closed', 'sla_resumed', 'sla_confirmed_complete',
                   'review_highlight_added', 'review_comment_added', 'review_clarification_requested', 'review_clarification_answered',
                   'revision_created', 'revision_started', 'revision_delivered', 'revision_approved', 'revision_resubmitted'));
