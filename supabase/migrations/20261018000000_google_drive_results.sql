-- =============================================================================
-- Drive A — Pusat Pengumpulan Hasil PIC: lampiran hasil (order_attachments, kind='result')
-- boleh tersimpan di Google Drive perusahaan alih-alih storage lokal/Supabase.
-- NON-DESTRUKTIF: tidak ada baris atau kolom lama yang dihapus/diubah nilainya.
--
-- Satu tabel lampiran tetap dipakai (tidak ada sistem lampiran kedua). Baris lama dan baris baru yang
-- TETAP memakai storage lokal/Supabase tidak berubah sama sekali: kolom di bawah semuanya NULL untuk
-- baris itu, dan storage_path tetap diisi seperti sebelumnya.
--
-- Penanda "file ini ada di Drive" adalah drive_file_id IS NOT NULL — bukan kolom enum terpisah, supaya
-- tidak ada dua sumber kebenaran yang bisa tidak sinkron.
--
-- storage_path diizinkan NULL: baris berbasis Drive tidak punya path storage lokal/Supabase sama sekali
-- (byte filenya hidup di Drive, bukan dua-duanya). Constraint unique lama tetap berlaku untuk baris yang
-- storage_path-nya terisi; Postgres memperbolehkan banyak NULL pada kolom unique, jadi banyak baris Drive
-- tidak akan saling bentrok.
--
-- sync_status: 'pending' (sedang diunggah ke Drive, baris dibuat SEBELUM percobaan agar klien melihat
-- progres dan request_key/upload_key dapat dipakai untuk rekonsiliasi bila proses terputus) →
-- 'synced' (Drive sudah menerima file dan metadata tersimpan) atau 'failed' (Drive gagal/timeout;
-- upload_key yang sama dipakai ulang saat retry, dicari dulu di Drive via appProperties sebelum
-- mengunggah ulang — lihat src/lib/server/drive — sehingga retry tidak pernah menggandakan file).
--
-- sync_locked_at: sewa singkat (pola sama dengan notification_outbox.locked_at pada worker Telegram) agar
-- dua permintaan dengan upload_key yang sama bersamaan (klik ganda, retry race) tidak keduanya memanggil
-- Drive untuk file yang sama. Baris dianggap bebas diklaim ulang bila locked_at kosong atau sudah lewat
-- masa sewa (lihat SYNC_LEASE_SECONDS di kode) — sehingga baris yang benar-benar terputus (proses mati
-- di tengah jalan) tidak terkunci selamanya.
-- =============================================================================

alter table public.order_attachments
  add column if not exists drive_file_id text,
  add column if not exists drive_folder_id text,
  add column if not exists drive_web_view_link text,
  add column if not exists sync_status text,
  add column if not exists sync_error text check (sync_error is null or char_length(sync_error) <= 500),
  add column if not exists sync_locked_at timestamptz,
  add column if not exists synced_at timestamptz;

-- storage_path hanya wajib untuk baris yang BUKAN berbasis Drive (konsisten dengan drive_file_id null = baris lama).
alter table public.order_attachments alter column storage_path drop not null;
alter table public.order_attachments drop constraint if exists order_attachments_storage_path_check;
alter table public.order_attachments add constraint order_attachments_storage_path_check
  check (storage_path is null or char_length(storage_path) between 1 and 512);

alter table public.order_attachments drop constraint if exists order_attachments_sync_status_check;
alter table public.order_attachments add constraint order_attachments_sync_status_check
  check (sync_status is null or sync_status in ('pending', 'synced', 'failed'));

-- drive_file_id hanya terisi TEPAT ketika sync_status = 'synced' — baris 'pending'/'failed' SENGAJA belum
-- punya drive_file_id (dibuat sebelum percobaan unggah selesai, lihat saveResultFile/claimRowForSync di
-- src/lib/server/repositories/results.ts), dan baris non-Drive (storage_path terisi) punya sync_status null.
-- ((drive_file_id is null) = (sync_status is null)) SALAH: itu melarang status 'pending'/'failed' punya
-- drive_file_id null, padahal itu justru keadaan yang sah (dan satu-satunya yang dibuat sebelum sinkron
-- selesai) — kesalahan ini ditemukan lewat uji E2E, migration ini belum pernah diterapkan ke produksi.
alter table public.order_attachments drop constraint if exists order_attachments_drive_pair_check;
alter table public.order_attachments add constraint order_attachments_drive_pair_check
  check ((drive_file_id is not null) = (sync_status = 'synced'));
-- Setiap baris wajib punya "rumah": storage_path (local/Supabase) ATAU sync_status terisi (baris berbasis
-- Drive, di status apa pun — pending/failed/synced — bukan hanya setelah drive_file_id benar-benar terisi).
alter table public.order_attachments drop constraint if exists order_attachments_location_check;
alter table public.order_attachments add constraint order_attachments_location_check
  check (storage_path is not null or sync_status is not null);

-- Pencarian idempoten saat retry (cari dulu sebelum unggah ulang) dan tampilan daftar hasil per order.
create index if not exists order_attachments_drive_file_id_idx on public.order_attachments (drive_file_id) where drive_file_id is not null;
create index if not exists order_attachments_sync_status_idx on public.order_attachments (sync_status) where sync_status = 'failed';
