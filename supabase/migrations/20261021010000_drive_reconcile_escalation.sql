-- Lacak kegagalan rekonsiliasi arsip Drive berturut-turut per order, untuk eskalasi bertahap
-- (lihat src/lib/server/services/drive-escalation.ts). Tambahan murni pada tabel yang sudah ada
-- (order_drive_sync) — tidak mengubah kolom lama, tidak menghapus data.
alter table public.order_drive_sync
  add column if not exists consecutive_fail_count integer not null default 0,
  add column if not exists escalated_at           timestamptz;
