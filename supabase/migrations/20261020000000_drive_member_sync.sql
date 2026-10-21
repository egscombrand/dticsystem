-- =============================================================================
-- Hasil sinkronisasi folder anggota Google Drive A (tombol "Sinkronkan Folder Anggota",
-- dashboard Super Admin > Pengaturan > Google Drive).
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: hanya kolom baru pada drive_integration_settings (baris id=1 yang sudah ada).
-- Status sinkronisasi folder anggota DISIMPAN TERPISAH dari status "Uji Koneksi" (last_test_*)
-- dan dari status upload hasil pekerjaan (order_attachments.sync_status) — ketiganya adalah
-- konsep yang berbeda (lihat AGENTS.md permintaan Super Admin: jangan mencampur status koneksi,
-- status sinkronisasi folder anggota, dan status pekerjaan).
-- =============================================================================

alter table public.drive_integration_settings
  add column if not exists last_member_sync_at timestamptz,
  add column if not exists last_member_sync_ok boolean,
  add column if not exists last_member_sync_summary jsonb;
