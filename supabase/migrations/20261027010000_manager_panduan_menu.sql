-- =============================================================================
-- Menu "Panduan Penggunaan" untuk role Manager (Panduan Penggunaan interaktif Manager).
-- Non-destruktif: hanya menambah satu baris menu dan satu nilai ikon baru; tidak menyentuh data pekerjaan.
-- Akses halaman /dtic/panduan tetap diperiksa di server (hanya role Manager, lihat halaman itu) —
-- allowed_roles di sini HANYA mengatur tampilan menu, bukan satu-satunya pengaman (lihat src/lib/menu.ts).
-- =============================================================================

alter table public.sidebar_menu_items drop constraint if exists sidebar_menu_items_icon_check;
alter table public.sidebar_menu_items add constraint sidebar_menu_items_icon_check
  check (icon in (
    'dashboard', 'list', 'kanban', 'calendar', 'file-plus', 'users', 'settings', 'shield', 'history',
    'sliders', 'globe', 'database', 'layers', 'book'
  ));

insert into public.sidebar_menu_items (key, parent_key, label, href, icon, required_capability, allowed_roles, is_core, sort_order) values
  ('panduan', null, 'Panduan Penggunaan', '/dtic/panduan', 'book', 'dashboard.view', array['manager'], false, 55)
on conflict (key) do nothing;
