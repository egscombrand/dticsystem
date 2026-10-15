-- =============================================================================
-- DTIC Connect — tujuan Telegram ke TOPIK tertentu pada grup forum
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: satu kolom nullable. Belum diterapkan ke production.
-- message_thread_id : ID topik (dari link t.me/c/<grup>/<topik>[/<pesan>]) bila grup berupa forum.
--                     Null = General / grup tanpa topik. Dipakai sebagai message_thread_id pada sendMessage.
-- =============================================================================

alter table public.telegram_brand_channels add column if not exists message_thread_id integer
  check (message_thread_id is null or message_thread_id > 1);
