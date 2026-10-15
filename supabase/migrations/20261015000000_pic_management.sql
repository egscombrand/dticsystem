-- =============================================================================
-- Manajemen PIC oleh Manager: notifikasi perubahan PIC + menu Workload Tim.
-- Non-destruktif: tidak menghapus order, penugasan, riwayat, atau audit.
--
-- 1. telegram_brand_channels.notify_pic_changed — toggle notifikasi "Perubahan PIC" (default aktif).
-- 2. notification_outbox: jenis 'pic_changed' (kind & event_type). event_ref = id baris auth_audit_log,
--    sehingga satu perubahan PIC = tepat satu notifikasi (unik per channel/kind/order/event_ref).
--    Notifikasi order baru TIDAK dikirim ulang untuk perubahan PIC.
-- 3. Menu sidebar "Workload Tim" (Super Admin & Manager; kapabilitas orders.view_all).
-- 4. Label menu "Daftar Order" → "Manajemen Order", hanya bila label belum diubah Super Admin.
--
-- Rollback aman: constraint lama dapat dipasang kembali setelah baris 'pic_changed' ditandai/dipindah;
-- kolom notify_pic_changed boleh dibiarkan (tidak dipakai kode lama).
-- =============================================================================

alter table public.telegram_brand_channels
  add column if not exists notify_pic_changed boolean not null default true;

alter table public.notification_outbox drop constraint if exists notification_outbox_kind_v2_check;
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_v3_check;
alter table public.notification_outbox add constraint notification_outbox_kind_v3_check
  check (kind in ('order_created', 'status_changed', 'pic_changed'));

alter table public.notification_outbox drop constraint if exists notification_outbox_event_type_check;
alter table public.notification_outbox add constraint notification_outbox_event_type_check
  check (event_type is null or event_type in ('new_order', 'status_changed', 'waiting_confirmation', 'completed', 'on_hold', 'cancelled', 'pic_changed'));

insert into public.sidebar_menu_items (key, parent_key, label, href, icon, required_capability, allowed_roles, is_core, sort_order) values
  ('workload', null, 'Workload Tim', '/dtic/workload', 'users', 'orders.view_all', array['super_admin', 'manager'], false, 35)
on conflict (key) do nothing;

update public.sidebar_menu_items set label = 'Manajemen Order' where key = 'orders' and label = 'Daftar Order';
