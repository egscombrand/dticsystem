-- =============================================================================
-- Menu "Distribusi Pekerjaan" (Manager & Super Admin) dan penamaan ulang menu internal.
-- Non-destruktif: hanya menambah satu baris menu dan mengubah label menu; tidak menyentuh data pekerjaan.
-- Hak akses tetap diperiksa di server (halaman mengharuskan orders.manage_pic).
-- =============================================================================

insert into public.sidebar_menu_items (key, parent_key, label, href, icon, required_capability, allowed_roles, is_core, sort_order) values
  ('distribusi', null, 'Distribusi Pekerjaan', '/dtic/distribusi', 'users', 'orders.view_all', array['super_admin', 'manager'], false, 36)
on conflict (key) do nothing;

update public.sidebar_menu_items set label = 'Pengelolaan Pekerjaan' where key = 'orders' and label in ('Daftar Order', 'Manajemen Order');
update public.sidebar_menu_items set label = 'Beban Kerja Tim' where key = 'workload' and label = 'Workload Tim';
