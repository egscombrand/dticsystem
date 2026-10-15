-- =============================================================================
-- DTIC System — penyesuaian form dengan struktur spreadsheet lama
-- -----------------------------------------------------------------------------
-- "Perusahaan" pada spreadsheet = brand di bawah naungan DTIC (orders.brand_id).
-- Kolom teks bebas orders.company tidak lagi diisi oleh form publik, sehingga
-- dibuat opsional. NON-DESTRUKTIF: tidak ada kolom/data yang dihapus; nilai lama
-- tetap tersimpan dan constraint panjang tetap berlaku bila diisi.
-- =============================================================================

alter table public.orders alter column company drop not null;
