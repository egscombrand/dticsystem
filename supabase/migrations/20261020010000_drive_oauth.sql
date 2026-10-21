-- =============================================================================
-- Koneksi OAuth 2.0 Google Drive atas nama akun pemilik folder My Drive (DTICSystemNexus).
-- -----------------------------------------------------------------------------
-- Alasan: service account (JWT, lihat drive_integration_settings) TIDAK memiliki kuota penyimpanan
-- sendiri dan GAGAL (HTTP 403 "Service Accounts do not have storage quota") saat mengunggah ISI file ke
-- folder My Drive biasa — sekadar membuat folder tetap berhasil karena itu operasi metadata, bukan
-- penyimpanan. OAuth atas nama akun pemilik folder memakai kuota akun itu sendiri, jadi tidak terbentur
-- batasan ini. NON-DESTRUKTIF: tabel baru, satu baris (id=1), tidak menyentuh tabel lain.
--
-- refresh_token_encrypted: AES-256-GCM (lihat src/lib/server/crypto.ts), kunci dari environment server
-- (GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY) — TIDAK PERNAH disimpan, dicatat ke log, atau dikirim ke browser
-- dalam bentuk apa pun selain status (terhubung/tidak + email akun).
-- =============================================================================

create table if not exists public.drive_oauth_connection (
  id                       smallint primary key default 1 check (id = 1),
  connected                boolean not null default false,
  account_email            text,
  refresh_token_encrypted  text,
  scope                    text,
  connected_at             timestamptz,
  connected_by             uuid references public.app_users (id) on delete set null,
  updated_at               timestamptz not null default now()
);

drop trigger if exists drive_oauth_connection_touch_updated_at on public.drive_oauth_connection;
create trigger drive_oauth_connection_touch_updated_at before update on public.drive_oauth_connection
  for each row execute function public.dtic_touch_updated_at();

insert into public.drive_oauth_connection (id) values (1)
on conflict (id) do nothing;

alter table public.drive_oauth_connection enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.drive_oauth_connection from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.drive_oauth_connection from authenticated;
  end if;
end;
$$;
