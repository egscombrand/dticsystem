-- =============================================================================
-- Menu sidebar "Riwayat QC" (Manager/Super Admin) — tab "Antrean QC" sendiri sudah dilayani lewat
-- /dtic/orders?view=qc (bukan menu baru, lihat src/app/dtic/(panel)/orders/page.tsx). Halaman ini HANYA
-- menampilkan riwayat KEPUTUSAN QC lintas-order yang sudah tercatat di order_workflow_events — tidak ada
-- tabel baru, tidak ada data yang diubah.
-- =============================================================================

insert into public.sidebar_menu_items (key, parent_key, label, href, icon, required_capability, allowed_roles, is_core, sort_order) values
  ('qc_history', null, 'Riwayat QC', '/dtic/qc-history', 'history', 'orders.view_all', array['super_admin','manager'], false, 25)
on conflict (key) do nothing;


