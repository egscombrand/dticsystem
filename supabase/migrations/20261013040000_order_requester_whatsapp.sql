-- =============================================================================
-- DTIC Connect — nomor WhatsApp pemohon (konfirmasi request)
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: hanya menambah kolom nullable + constraint format.
--
-- orders.requester_whatsapp : "628xxxxxxxxx" (kode negara tanpa "+"), hasil normalisasi di server.
--   * NULL untuk pengajuan lama yang dibuat sebelum field ini ada (tetap bisa dibaca).
--   * Pengajuan baru diwajibkan lewat validasi aplikasi; database hanya menjaga format.
-- =============================================================================

alter table public.orders add column if not exists requester_whatsapp text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_requester_whatsapp_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_requester_whatsapp_check
      check (requester_whatsapp is null or requester_whatsapp ~ '^628[0-9]{7,11}$');
  end if;
end;
$$;
