-- =============================================================================
-- Kategori pekerjaan baru: Editing Kelas GreenSkill ID — tim + tiga jenis pekerjaan.
-- -----------------------------------------------------------------------------
-- NON-DESTRUKTIF: pola identik seed tim & jenis order yang sudah ada (lihat
-- 20261014050000_team_auto_assignment.sql dan 20261009020000_master_data.sql).
-- Tidak mengubah kategori/jenis lama, tidak menyentuh order/riwayat yang sudah tersimpan.
--
-- Anggota tim: Stevan Hary Laksono (Video Production) & Nuri Khusnaini (juga anggota Dokumentasi &
-- Event — satu orang boleh menjadi anggota lebih dari satu tim, dtic_team_members tidak membatasi itu).
-- Dicocokkan ke dtic_members yang SUDAH ADA (pola identik 20261014050000_team_auto_assignment.sql);
-- tidak membuat anggota/akun baru. Yang tidak ditemukan dilaporkan sebagai WARNING, bukan menggagalkan migration.
-- =============================================================================

insert into public.dtic_teams (slug, name, description, sort_order) values
  ('editing-kelas-greenskill-id', 'Editing Kelas GreenSkill ID', 'Produksi video LMS, editing rekaman webinar, editing clipper kelas untuk GreenSkill ID.', 4)
on conflict (slug) do nothing;

insert into public.design_order_types (name, team_id, requires_detail, sort_order)
select v.name, t.id, false, v.sort_order
from (values
  ('Produksi Video LMS',       20),
  ('Editing Rekaman Webinar',  21),
  ('Editing Clipper Kelas',    22)
) as v(name, sort_order)
cross join (select id from public.dtic_teams where slug = 'editing-kelas-greenskill-id') as t
on conflict (lower(name)) do nothing;

do $$
declare
  r record;
  found_id uuid;
  team_id_v uuid;
begin
  select id into team_id_v from public.dtic_teams where slug = 'editing-kelas-greenskill-id';
  for r in select * from (values ('Stevan Hary Laksono'), ('Nuri Khusnaini')) as s(full_name)
  loop
    select m.id into found_id from public.dtic_members m where lower(m.full_name) = lower(r.full_name) limit 1;
    if found_id is null then
      raise warning 'Anggota tidak ditemukan: % untuk tim Editing Kelas GreenSkill ID. Tidak ditambahkan; periksa data Member DTIC.', r.full_name;
    else
      insert into public.dtic_team_members (team_id, member_id) values (team_id_v, found_id) on conflict do nothing;
    end if;
  end loop;
end;
$$;
