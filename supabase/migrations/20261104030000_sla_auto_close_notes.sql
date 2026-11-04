-- =============================================================================
-- Lengkapi catatan peristiwa Auto-Closed SLA yang sudah tercatat sebelum catatan otomatis ditambahkan:
-- teks catatan sistem (summary), jenis penutupan AUTO_CLOSED_SLA, dan durasi keterlambatan (menit).
-- Idempotent: hanya baris sla_auto_closed yang summary-nya masih kosong. Tidak menyentuh status order.
-- =============================================================================

update public.order_workflow_events e
set summary = 'Pengajuan otomatis ditutup oleh sistem karena telah melewati batas SLA. Status pekerjaan sebelumnya adalah '
              || case e.detail->>'statusAtClosure'
                   when 'submitted' then 'Pengajuan Masuk'
                   when 'assigned' then 'Siap Dikerjakan'
                   when 'in_progress' then 'Sedang Dikerjakan'
                   when 'pending_confirmation' then 'Menunggu QC Manager'
                   when 'internal_revision' then 'Perlu Revisi Internal'
                   when 'awaiting_requester' then 'Menunggu Masukan Pemohon'
                   when 'on_hold' then 'Ditunda'
                   else coalesce(e.detail->>'statusAtClosure', '-')
                 end
              || '. PIC tetap dapat melanjutkan pekerjaan dan memperbarui status sesuai kondisi sebenarnya.',
    detail = e.detail
             || jsonb_build_object('closureType', 'AUTO_CLOSED_SLA')
             || case
                  when e.detail ? 'slaDeadlineAt' and e.detail ? 'slaClosedAt' then
                    jsonb_build_object('lateMinutes', greatest(0, round(extract(epoch from
                      ((e.detail->>'slaClosedAt')::timestamptz - (e.detail->>'slaDeadlineAt')::timestamptz)) / 60)::int))
                  else '{}'::jsonb
                end
where e.kind = 'sla_auto_closed'
  and e.summary is null;
