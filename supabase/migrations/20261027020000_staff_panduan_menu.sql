-- =============================================================================
-- Menu "Panduan Penggunaan" kini juga untuk role Staff (PIC) — panduan interaktif PIC.
-- Non-destruktif: hanya mengubah allowed_roles satu baris menu yang sudah ada; tidak menyentuh data
-- pekerjaan. Akses halaman /dtic/panduan tetap diperiksa di server untuk role dengan panduan terisi
-- saja (lihat halaman itu) — allowed_roles di sini HANYA mengatur tampilan menu, bukan satu-satunya
-- pengaman (lihat src/lib/menu.ts).
-- =============================================================================

update public.sidebar_menu_items
set allowed_roles = array['manager', 'staff']
where key = 'panduan' and allowed_roles = array['manager'];
