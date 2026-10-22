-- Riwayat SETIAP percobaan rekonsiliasi arsip Drive per order (bukan hanya percobaan terakhir seperti
-- order_drive_sync) — supaya penyebab kegagalan yang sebenarnya (pesan error Drive asli, bukan hanya
-- hitungan) bisa ditelusuri dan ditampilkan di halaman Detail Pekerjaan. Tambahan murni tabel baru —
-- tidak mengubah/menghapus kolom atau tabel yang sudah ada (order_drive_sync tetap dipakai sebagai
-- snapshot status TERKINI, tidak digantikan).
create table if not exists public.order_drive_reconcile_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  status text not null check (status in ('success', 'partial', 'failed')),
  message text not null,
  -- Pesan error ASLI yang ditangkap dari Drive (satu baris per kegagalan pencarian folder/file), bukan
  -- sekadar hitungan — null bila tidak ada kegagalan sama sekali pada percobaan ini.
  error_detail text,
  triggered_by text not null check (triggered_by in ('page_view', 'manual', 'worker'))
);

create index if not exists order_drive_reconcile_log_order_id_attempted_at_idx
  on public.order_drive_reconcile_log (order_id, attempted_at desc);
