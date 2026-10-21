-- =============================================================================
-- Pengaturan admin integrasi Google Drive A (dashboard Super Admin).
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: hanya tabel baru + satu baris menu baru; tidak menyentuh order_attachments,
-- orders, atau data pekerjaan apa pun.
--
-- drive_integration_settings: SATU baris (id=1), sama seperti site_settings. Menyimpan HANYA
-- keputusan admin (aktif/tidak) dan hasil pengujian koneksi terakhir — TIDAK PERNAH kredensial
-- Google (service account email/private key/folder id tetap di environment variable server,
-- lihat GOOGLE_SERVICE_ACCOUNT_* / GOOGLE_DRIVE_ROOT_FOLDER_ID). Tujuannya: mengisi environment
-- variable saja TIDAK otomatis membuat upload PIC memakai Drive — Super Admin harus menjalankan
-- Uji Koneksi dan menekan Aktifkan Integrasi secara sengaja (lihat src/lib/server/repositories/
-- drive-settings.ts, fungsi setDriveEnabled).
-- =============================================================================

create table if not exists public.drive_integration_settings (
  id                 smallint primary key default 1 check (id = 1),
  enabled            boolean not null default false,
  enabled_at         timestamptz,
  enabled_by         uuid references public.app_users (id) on delete set null,
  last_test_at       timestamptz,
  last_test_ok       boolean,
  last_test_message  text check (last_test_message is null or char_length(last_test_message) <= 300),
  updated_at         timestamptz not null default now()
);

drop trigger if exists drive_integration_settings_touch_updated_at on public.drive_integration_settings;
create trigger drive_integration_settings_touch_updated_at before update on public.drive_integration_settings
  for each row execute function public.dtic_touch_updated_at();

insert into public.drive_integration_settings (id) values (1)
on conflict (id) do nothing;

alter table public.drive_integration_settings enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.drive_integration_settings from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.drive_integration_settings from authenticated;
  end if;
end;
$$;

-- Menu sidebar "Google Drive" (Super Admin saja, kapabilitas site.manage — sama dengan Integrasi Telegram).
insert into public.sidebar_menu_items (key, parent_key, label, href, icon, required_capability, allowed_roles, is_core, sort_order) values
  ('google_drive', 'settings', 'Google Drive', '/dtic/settings/integrations/google-drive', 'layers', 'site.manage', array['super_admin'], false, 75)
on conflict (key) do nothing;
