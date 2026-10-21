-- =============================================================================
-- Hasil pekerjaan berupa TAUTAN (website, repo, hosting) — bukan file. Dibuat terpisah dari
-- order_attachments (yang berbentuk file: file_size/mime_type/Drive) karena bentuk datanya memang berbeda,
-- bukan sekadar varian lain dari attachment. Idenpoten/aman diulang: PIC bisa menambah beberapa link.
-- NON-DESTRUKTIF: tabel baru, tidak menyentuh order_attachments atau data lain.
-- =============================================================================

create table if not exists public.order_result_links (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  url          text not null check (char_length(url) between 1 and 2048),
  title        text not null check (char_length(title) between 1 and 200),
  description  text check (description is null or char_length(description) <= 1000),
  created_by   uuid references public.app_users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists order_result_links_order_idx on public.order_result_links (order_id, created_at);

alter table public.order_result_links enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.order_result_links from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.order_result_links from authenticated;
  end if;
end;
$$;
