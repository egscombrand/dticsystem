-- =============================================================================
-- DTIC Connect — satu grup Telegram GLOBAL untuk semua brand
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: konfigurasi per brand lama TIDAK dihapus, hanya tidak lagi dipakai routing.
-- Belum diterapkan ke production.
--
-- Grup global = baris telegram_brand_channels dengan brand_id = null (sebelumnya "Grup Default").
-- Semua notifikasi, dari brand mana pun, dikirim ke grup ini. Brand tetap dicantumkan di isi pesan.
-- =============================================================================

-- Grup brand lama tidak lagi dipakai routing, sehingga satu grup boleh tercatat di baris lama dan baris global.
alter table public.telegram_brand_channels drop constraint if exists telegram_brand_channels_chat_key;

-- Pakai ulang konfigurasi lama yang valid: bila grup global belum ada dan hanya ada SATU grup brand terverifikasi,
-- salin (bukan pindahkan) grup itu menjadi grup global. Baris lama tetap ada.
insert into public.telegram_brand_channels (
  brand_id, chat_id, chat_title, chat_username, source_link, message_thread_id, is_active, verification_status, verified_at,
  notify_new_order, notify_status_changed, notify_waiting_confirmation, notify_completed, notify_on_hold, notify_cancelled,
  created_by, updated_by)
select null, c.chat_id, c.chat_title, c.chat_username, c.source_link, c.message_thread_id, c.is_active, c.verification_status, c.verified_at,
  c.notify_new_order, c.notify_status_changed, c.notify_waiting_confirmation, c.notify_completed, c.notify_on_hold, c.notify_cancelled,
  c.created_by, c.updated_by
from public.telegram_brand_channels c
where c.brand_id is not null and c.verification_status = 'verified'
  and not exists (select 1 from public.telegram_brand_channels g where g.brand_id is null)
  and (select count(*) from public.telegram_brand_channels x where x.brand_id is not null and x.verification_status = 'verified') = 1;

-- Menu "Integrasi Telegram per Brand" tidak dipakai lagi: disembunyikan (halaman dialihkan ke Integrasi Telegram).
update public.sidebar_menu_items set is_core = false, is_visible = false where key = 'telegram_brands';
