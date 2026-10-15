-- =============================================================================
-- Isi tim (kategori) pada pekerjaan lama yang belum punya team_id, dari jenis pekerjaannya.
-- Hanya menyentuh baris dengan team_id NULL dan jenis yang sudah memiliki tim; idempoten.
-- Tidak mengubah PIC, status, judul, deskripsi, atau riwayat. Aplikasi sudah memakai tim jenis
-- sebagai cadangan (coalesce), sehingga migrasi ini hanya merapikan data.
-- =============================================================================
update public.orders o
   set team_id = t.team_id
  from public.design_order_types t
 where o.design_order_type_id = t.id
   and o.team_id is null
   and t.team_id is not null;
