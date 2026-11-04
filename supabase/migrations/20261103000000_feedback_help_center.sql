-- =============================================================================
-- Floating Help Center — menggunakan kembali sistem tiket Bantuan & Masukan yang sudah ada
-- (feedback_tickets dkk., lihat 20261023000000_feedback_tickets.sql). TIDAK ada tabel baru: seluruh
-- kebutuhan "Tiket Saya", filter, riwayat, dan lampiran sudah tersedia di skema yang ada.
-- Satu-satunya tambahan: kolom reporter_role (role pelapor SAAT melapor — "Role pengguna" yang diminta
-- spesifikasi Pusat Bantuan, berguna bagi Admin saat triase). Nullable: null untuk tiket lama & pelapor
-- tamu (Pemohon, tanpa akun).
-- =============================================================================

alter table public.feedback_tickets
  add column if not exists reporter_role text check (reporter_role in ('super_admin', 'manager', 'staff'));
