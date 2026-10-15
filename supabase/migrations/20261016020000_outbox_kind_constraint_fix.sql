-- =============================================================================
-- Perbaikan error "Kelola PIC" di produksi: constraint lama notification_outbox_kind_v2_check
-- (hanya 'order_created','status_changed') masih ada berdampingan dengan v3, sehingga antrean
-- notifikasi 'pic_changed' ditolak dan transaksi perubahan PIC gagal.
-- Hanya menghapus constraint lama; constraint v3 (termasuk 'pic_changed') tetap berlaku.
-- Non-destruktif dan idempoten.
-- =============================================================================
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_v2_check;
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_kind_v3_check' and conrelid = 'public.notification_outbox'::regclass) then
    alter table public.notification_outbox add constraint notification_outbox_kind_v3_check
      check (kind in ('order_created', 'status_changed', 'pic_changed'));
  end if;
end $$;
