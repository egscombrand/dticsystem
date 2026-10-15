-- =============================================================================
-- DTIC Connect — hapus kode pelacakan terpisah
-- -----------------------------------------------------------------------------
-- Pencarian riwayat kini memakai nomor order saja (tanpa kode kedua).
-- Kolom tracking_code_hash hanya pernah terisi oleh fitur yang dibatalkan dan
-- dipastikan kosong sebelum migration ini dibuat. Migration ini idempoten.
-- Tidak menghapus data order, lampiran, atau riwayat status.
-- =============================================================================

do $$
begin
  -- Hanya hapus bila benar-benar kosong; jika ada isinya, hentikan (jangan kehilangan data diam-diam).
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'orders' and column_name = 'tracking_code_hash') then
    if exists (select 1 from public.orders where tracking_code_hash is not null) then
      raise exception 'orders.tracking_code_hash masih berisi data; migration dihentikan.';
    end if;
    alter table public.orders drop constraint if exists orders_tracking_code_hash_check;
    alter table public.orders drop constraint if exists orders_tracking_code_hash_key;
    alter table public.orders drop column tracking_code_hash;
  end if;
end;
$$;
