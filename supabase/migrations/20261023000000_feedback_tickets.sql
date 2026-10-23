-- =============================================================================
-- Bantuan & Masukan — sistem tiket resmi (bug/saran/permintaan fitur/pertanyaan) untuk pemohon DAN
-- staf internal, dikelola Super Admin. NON-DESTRUKTIF: tabel baru, tidak menyentuh data order/QC yang
-- sudah ada. Status tiket SENGAJA terpisah total dari status pekerjaan/QC (lihat feedback_tickets.status
-- vs orders.status) — related_order_id hanya TAUTAN, mengubah status tiket tidak pernah mengubah order.
-- =============================================================================

-- Penghitung nomor tiket per tahun — pola identik order_number_counters (aman terhadap pengajuan
-- bersamaan: INSERT .. ON CONFLICT DO UPDATE mengunci baris tahun tersebut).
create table if not exists public.feedback_ticket_counters (
  year        integer primary key check (year between 2000 and 9999),
  last_value  integer not null default 0 check (last_value >= 0)
);

create table if not exists public.feedback_tickets (
  id                  uuid primary key default gen_random_uuid(),
  ticket_number       text not null,
  kind                text not null check (kind in ('bug', 'suggestion', 'feature_request', 'question')),
  title               text not null check (char_length(btrim(title)) between 3 and 160),
  related_page        text not null check (related_page in ('home', 'submit', 'history', 'detail', 'qc', 'result_files', 'other')),
  detail              text not null check (char_length(btrim(detail)) between 10 and 5000),
  -- Wajib diisi hanya untuk kind='bug' (diperiksa di aplikasi, bukan di sini — CHECK ini hanya memastikan
  -- nilainya valid BILA diisi). Tingkat dampak yang DILAPORKAN pengguna, bukan prioritas final Super Admin.
  impact              text check (impact in ('low', 'normal', 'high')),
  related_order_id    uuid references public.orders (id) on delete set null,
  -- Pelapor internal (staf login) — diisi dari SESI server, bukan field formulir (lihat submitFeedbackTicket).
  reporter_user_id    uuid references public.app_users (id) on delete set null,
  -- Identitas tamu (pemohon publik, tanpa akun) — sama seperti requester_name/requester_whatsapp di orders.
  reporter_name       text not null check (char_length(btrim(reporter_name)) between 1 and 120),
  reporter_contact    text check (reporter_contact is null or char_length(reporter_contact) <= 160),
  status              text not null default 'new'
                        check (status in ('new', 'reviewed', 'in_progress', 'need_info', 'done', 'wont_fix')),
  -- Prioritas INTERNAL (ditetapkan Super Admin) — terpisah dari `impact` yang dilaporkan pengguna.
  priority            text check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_user_id    uuid references public.app_users (id) on delete set null,
  resolution_summary  text check (resolution_summary is null or char_length(resolution_summary) <= 3000),
  close_reason        text check (close_reason is null or char_length(close_reason) <= 1000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint feedback_tickets_ticket_number_key unique (ticket_number),
  constraint feedback_tickets_ticket_number_format check (ticket_number ~ '^FB-[0-9]{4}-[0-9]{5,}$'),
  -- Tidak ditindaklanjuti wajib punya alasan tercatat (lihat spesifikasi bagian 5).
  constraint feedback_tickets_wont_fix_needs_reason check (status <> 'wont_fix' or close_reason is not null)
);

create index if not exists feedback_tickets_status_idx on public.feedback_tickets (status);
create index if not exists feedback_tickets_created_at_idx on public.feedback_tickets (created_at desc);
create index if not exists feedback_tickets_reporter_user_id_idx on public.feedback_tickets (reporter_user_id);
create index if not exists feedback_tickets_related_order_id_idx on public.feedback_tickets (related_order_id);

create table if not exists public.feedback_attachments (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references public.feedback_tickets (id) on delete cascade,
  file_name     text not null check (char_length(file_name) between 1 and 255),
  storage_path  text not null check (char_length(storage_path) between 1 and 512),
  mime_type     text not null check (char_length(mime_type) between 1 and 127),
  file_size     bigint not null check (file_size > 0),
  created_at    timestamptz not null default now(),
  constraint feedback_attachments_storage_path_key unique (storage_path)
);

create index if not exists feedback_attachments_ticket_id_idx on public.feedback_attachments (ticket_id);

-- Audit trail BERTAMBAH SAJA (append-only, sama seperti order_workflow_events) — satu baris per kejadian:
-- dibuat, status/prioritas/penanggung jawab berubah, catatan ditambahkan, info diminta/diberikan, selesai/
-- tidak ditindaklanjuti. visible_to_reporter membedakan balasan untuk pelapor vs catatan internal Super Admin.
create table if not exists public.feedback_ticket_events (
  id                    uuid primary key default gen_random_uuid(),
  ticket_id             uuid not null references public.feedback_tickets (id) on delete cascade,
  kind                  text not null check (kind in (
                          'created', 'status_changed', 'priority_changed', 'assignee_changed',
                          'note_added', 'info_requested', 'info_provided', 'resolved', 'wont_fix'
                        )),
  actor_user_id         uuid references public.app_users (id) on delete set null,
  actor_name            text,
  visible_to_reporter   boolean not null default false,
  message               text check (message is null or char_length(message) <= 3000),
  detail                jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists feedback_ticket_events_ticket_id_idx on public.feedback_ticket_events (ticket_id, created_at);

-- Nomor tiket FB-YYYY-NNNNN (tahun menurut Asia/Jakarta), dibuat di database — tidak pernah bentrok
-- walaupun ada pengajuan bersamaan (pola identik dtic_assign_order_number).
create or replace function public.dtic_assign_ticket_number() returns trigger
language plpgsql as $$
declare
  v_year  integer := extract(year from (now() at time zone 'Asia/Jakarta'))::integer;
  v_next  integer;
begin
  insert into public.feedback_ticket_counters as c (year, last_value)
  values (v_year, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning c.last_value into v_next;

  new.ticket_number := 'FB-' || v_year || '-' || lpad(v_next::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists feedback_tickets_assign_ticket_number on public.feedback_tickets;
create trigger feedback_tickets_assign_ticket_number
  before insert on public.feedback_tickets
  for each row execute function public.dtic_assign_ticket_number();

-- updated_at otomatis (fungsi dtic_touch_updated_at sudah ada sejak migration awal).
drop trigger if exists feedback_tickets_touch_updated_at on public.feedback_tickets;
create trigger feedback_tickets_touch_updated_at
  before update on public.feedback_tickets
  for each row execute function public.dtic_touch_updated_at();

alter table public.feedback_ticket_counters enable row level security;
alter table public.feedback_tickets         enable row level security;
alter table public.feedback_attachments     enable row level security;
alter table public.feedback_ticket_events   enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.feedback_ticket_counters, public.feedback_tickets,
                  public.feedback_attachments, public.feedback_ticket_events from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.feedback_ticket_counters, public.feedback_tickets,
                  public.feedback_attachments, public.feedback_ticket_events from authenticated;
  end if;
end;
$$;

-- sidebar_menu_items.required_capability dibatasi CHECK eksplisit sejak migration awal (hanya kapabilitas
-- yang ada waktu itu) — diperlebar di sini mencakup SELURUH kapabilitas yang ada di permissions.ts
-- sekarang (termasuk drive.diagnose yang ditambahkan sebelumnya tanpa entri menu, dan feedback.manage
-- yang baru), bukan hanya menambah satu nilai, supaya menu berikutnya tidak perlu ALTER lagi per kapabilitas.
alter table public.sidebar_menu_items drop constraint if exists sidebar_menu_items_required_capability_check;
alter table public.sidebar_menu_items add constraint sidebar_menu_items_required_capability_check
  check (required_capability in (
    'dashboard.view', 'orders.view_all', 'orders.update', 'orders.delete', 'orders.manage_pic',
    'orders.status', 'orders.qc', 'orders.workflow', 'master.manage', 'members.view', 'users.manage',
    'site.manage', 'audit.view', 'drive.diagnose', 'feedback.manage'
  ));

-- Menu sidebar internal — Super Admin saja (kapabilitas feedback.manage, lihat permissions.ts).
insert into public.sidebar_menu_items (key, parent_key, label, href, icon, required_capability, allowed_roles, is_core, sort_order) values
  ('feedback', null, 'Bantuan & Masukan', '/dtic/settings/feedback', 'history', 'feedback.manage', array['super_admin'], false, 65)
on conflict (key) do nothing;
