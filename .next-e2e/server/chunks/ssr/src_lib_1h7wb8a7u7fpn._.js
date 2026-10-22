(()=>{"use strict";module.exports=[27291,a=>{var b=a.i(84896);a.s(["c",0,{none:"Belum ada hasil",collecting:"Sedang dikumpulkan",pending_review:"Menunggu pemeriksaan",needs_revision:"Perlu revisi",approved:"Disetujui",done:"Selesai"},"D",0,{none:"muted",collecting:"info",pending_review:"violet",needs_revision:"danger",approved:"success",done:"success"},"q",0,function(a){return b.S.includes(a.orderStatus)?"done":"approved"===a.qcStatus?"approved":"revision"===a.qcStatus?"needs_revision":"pending"===a.qcStatus?"pending_review":a.resultCount>0?"collecting":"none"}])},86326,a=>{var b=a.i(22126),c=a.i(90428),d=a.i(14766),e=a.i(84896);a.i(5032),a.i(25251);var f=a.i(27291);a.i(78160);let g=e.S,h=["pending_confirmation"];function i(a){return{id:a.id,orderNumber:a.order_number,requesterName:a.requester_name,company:a.company,department:a.department,title:a.title,designType:a.design_type,brandId:a.brand_id,brandName:a.brand_name,deadlineAt:a.deadline_at.toISOString(),priority:a.priority,priorityName:a.priority_name,priorityTone:a.priority_tone,status:a.status,qcStatus:a.qc_status,createdAt:a.created_at.toISOString(),teamId:a.team_id??null,teamName:a.team_name??null,assignees:Array.isArray(a.assignees)?a.assignees:[]}}function j(a){return a`o.id, o.order_number, o.requester_name, o.company, o.department, o.title, o.design_type,
            o.brand_id, b.name as brand_name, o.deadline_at, o.priority, p.name as priority_name,
            p.tone as priority_tone, o.status, o.qc_status, o.created_at,
            coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id)) as team_id,
            (select t.name from dtic_teams t where t.id = coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id))) as team_name,
            coalesce((
              select json_agg(json_build_object(
                       'id', m.id, 'name', m.full_name, 'division', m.position || ' of ' || d.name, 'isActive', m.is_active
                     ) order by d.sort_order, m.sort_order, m.full_name)
              from order_assignments a
              join dtic_members m on m.id = a.member_id
              join dtic_departments d on d.id = m.department_id
              where a.order_id = o.id
            ), '[]'::json) as assignees`}function k(a,b){return b?"none"===b?a`and not exists (select 1 from order_assignments a where a.order_id = o.id)`:a`and exists (select 1 from order_assignments a where a.order_id = o.id and a.member_id = ${b})`:a``}function l(a){return a`orders o join brands b on b.id = o.brand_id join priority_levels p on p.code = o.priority`}function m(a){return a.replace(/[\\%_]/g,a=>`\\${a}`)}function n(a,b){let d=(0,c.j)(b);switch(a){case"overdue":return{overdue:!0};case"today":return{from:(0,c.P)(d),to:(0,c.P)((0,c.s)(d,1))};case"week":return{from:(0,c.P)(d),to:(0,c.P)((0,c.s)(d,7))};case"month":{let[a,b]=d.split("-").map(Number),e=`${a}-${String(b).padStart(2,"0")}-01`,f=12===b?`${a+1}-01-01`:`${a}-${String(b+1).padStart(2,"0")}-01`;return{from:(0,c.P)(e),to:(0,c.P)(f)}}}}let o={newest:"o.created_at desc, o.order_number desc",oldest:"o.created_at asc, o.order_number asc",deadline_asc:"o.deadline_at asc, o.created_at asc",deadline_desc:"o.deadline_at desc, o.created_at desc",qc_queue:`(o.deadline_at < now() and o.status not in ('completed','cancelled')) desc,
              o.deadline_at asc,
              coalesce((select max(e.created_at) from order_workflow_events e where e.order_id = o.id and e.kind = 'qc_submitted'), o.created_at) asc`};function p(a,b){return b?b.memberId?a`and exists (select 1 from order_assignments sa where sa.order_id = o.id and sa.member_id = ${b.memberId})`:a`and false`:a``}async function q(a){let[b]=await (0,d.f)()`
    select m.full_name from order_assignments a join dtic_members m on m.id = a.member_id
    where a.order_id = ${a}
    order by a.assigned_at asc, a.member_id asc
    limit 1`;return b?.full_name??null}async function r(a,c=new Date){let e=(0,d.f)(),h=Math.max(1,a.page??1),q=(h-1)*b.z,s=a.q?.trim(),t=s?`%${m(s)}%`:null,u=a.deadline?n(a.deadline,c):null,v=e`
    where true
    ${t?e`and (o.order_number ilike ${t} or o.requester_name ilike ${t}
               or o.company ilike ${t} or b.name ilike ${t} or o.title ilike ${t})`:e``}
    ${a.brandId?e`and o.brand_id = ${a.brandId}`:e``}
    ${a.statuses?.length?e`and o.status in ${e(a.statuses)}`:e``}
    ${a.from?e`and o.created_at >= ${a.from}`:e``}
    ${a.to?e`and o.created_at < ${a.to}`:e``}
    ${a.teamId?e`and coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id)) = ${a.teamId}`:e``}
    ${a.priority?e`and o.priority = ${a.priority}`:e``}
    ${a.qcStatus?e`and o.qc_status = ${a.qcStatus}`:e``}
    ${k(e,a.assignee)}
    ${p(e,a.scope)}
    ${u?.overdue?e`and o.deadline_at < ${c} and o.status not in ${e(g)}`:e``}
    ${u?.from?e`and o.deadline_at >= ${u.from}`:e``}
    ${u?.to?e`and o.deadline_at < ${u.to}`:e``}`,[w,[{total:x}]]=await Promise.all([e`
      select ${j(e)}, ${e`
    (select count(*)::int from order_attachments a where a.order_id = o.id and a.kind = 'reference') as reference_count,
    (select count(*)::int from order_attachments a where a.order_id = o.id and a.kind = 'result' and a.drive_file_id is not null and a.reconcile_status is null) as result_count,
    (select count(*)::int from order_attachments a where a.order_id = o.id and a.kind = 'result' and a.sync_status in ('pending','failed')) as result_pending_count,
    (select count(*)::int from order_attachments a where a.order_id = o.id and a.kind = 'result' and a.reconcile_status is not null) as result_reconcile_count,
    ods.last_sync_at, ods.last_sync_status,
    exists(select 1 from notification_outbox n where n.order_id = o.id and n.channel = 'telegram' and n.status = 'failed') as telegram_notify_failed,
    (select h.changed_at from order_status_history h where h.order_id = o.id and h.new_status = 'assigned' order by h.changed_at desc limit 1) as assigned_at,
    (o.status not in ('completed', 'cancelled')
      and (select e.needs_revision from order_workflow_events e where e.order_id = o.id and e.kind = 'feedback_recorded' order by e.created_at desc limit 1) = false
    ) as needs_pic_closure`}
      from ${l(e)} ${e`left join order_drive_sync ods on ods.order_id = o.id`}
      ${v}
      order by ${e.unsafe(o[a.sort??"newest"])}
      limit ${b.z} offset ${q}`,e`select count(*)::int as total from ${l(e)} ${v}`]);return{items:w.map(a=>{var b,c;return{...i(a),...(b=a.status,c=a.qc_status,{referenceCount:a.reference_count,resultCount:a.result_count,resultPendingCount:a.result_pending_count,resultReconcileCount:a.result_reconcile_count,collectionStatus:(0,f.q)({orderStatus:b,qcStatus:c,resultCount:a.result_count}),lastSyncAt:a.last_sync_at?.toISOString()??null,lastSyncStatus:a.last_sync_status,telegramNotifyFailed:a.telegram_notify_failed,assignedAt:a.assigned_at?.toISOString()??null,needsPicClosure:a.needs_pic_closure})}}),total:x,page:h,pageSize:b.z}}async function s(a,b=new Date){let c=(0,d.f)(),f=a.q?.trim(),g=f?`%${m(f)}%`:null,i=a.deadline?n(a.deadline,b):null,j=(d,e)=>c`
    where true
    and o.status in ${c(d)}
    ${e?c`and o.deadline_at < ${b}`:c``}
    ${g?c`and (o.order_number ilike ${g} or o.requester_name ilike ${g}
               or o.company ilike ${g} or b.name ilike ${g} or o.title ilike ${g})`:c``}
    ${a.brandId?c`and o.brand_id = ${a.brandId}`:c``}
    ${a.from?c`and o.created_at >= ${a.from}`:c``}
    ${a.to?c`and o.created_at < ${a.to}`:c``}
    ${a.teamId?c`and coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id)) = ${a.teamId}`:c``}
    ${a.priority?c`and o.priority = ${a.priority}`:c``}
    ${k(c,a.assignee)}
    ${p(c,a.scope)}
    ${!e&&i?.overdue?c`and o.deadline_at < ${b}`:c``}
    ${i?.from?c`and o.deadline_at >= ${i.from}`:c``}
    ${i?.to?c`and o.deadline_at < ${i.to}`:c``}`,[[{c:o}],[{c:q}],[{c:r}],[{c:t}],[{c:u}]]=await Promise.all([c`select count(*)::int as c from ${l(c)} ${j(e.E,!1)}`,c`select count(*)::int as c from ${l(c)} ${j(e.G,!1)}`,c`select count(*)::int as c from ${l(c)} ${j(e.S,!1)}`,c`select count(*)::int as c from ${l(c)} ${j(e.E,!0)}`,c`select count(*)::int as c from ${l(c)} ${j(h,!1)}`]);return{active:o,actionNeeded:q,finished:r,overdueActive:t,qcQueue:u}}async function t(a={}){let b=(0,d.f)(),c=a.q?.trim(),e=c?`%${m(c)}%`:null;return(await b`
    select ${j(b)}
    from ${l(b)}
    where true
    ${a.brandId?b`and o.brand_id = ${a.brandId}`:b``}
    ${k(b,a.assignee)}
    ${p(b,a.scope)}
    ${e?b`and (o.order_number ilike ${e} or o.title ilike ${e} or o.requester_name ilike ${e})`:b``}
    order by o.deadline_at asc
    limit 1000`).map(i)}let u="Asia/Jakarta";async function v(a){let b=(0,d.f)();return(await b`
    select ${j(b)}
    from ${l(b)}
    where o.deadline_at >= ${a.from} and o.deadline_at < ${a.to}
    ${function(a,b,c,d=new Date){let e=b.q?.trim()?`%${m(b.q.trim())}%`:null;return a`
    ${b.brandId?a`and o.brand_id = ${b.brandId}`:a``}
    ${b.teamId?a`and coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id)) = ${b.teamId}`:a``}
    ${b.typeId?a`and o.design_order_type_id = ${b.typeId}`:a``}
    ${e?a`and (o.title ilike ${e} or o.order_number ilike ${e} or o.requester_name ilike ${e})`:a``}
    ${b.overdue?a`and o.deadline_at < ${d} and o.status not in ${a(g)}`:a``}
    ${b.status?a`and o.status = ${b.status}`:a``}
    ${b.priority?a`and o.priority = ${b.priority}`:a``}
    ${"none"===b.pic?a`and not exists (select 1 from order_assignments a where a.order_id = o.id)`:b.pic?a`and exists (select 1 from order_assignments a where a.order_id = o.id and a.member_id = ${b.pic})`:a``}
    ${b.fromKey?a`and (o.deadline_at at time zone ${u})::date >= ${b.fromKey}::date`:a``}
    ${b.toKey?a`and (o.deadline_at at time zone ${u})::date <= ${b.toKey}::date`:a``}
    ${p(a,c)}`}(b,a,a.scope)}
    order by o.deadline_at asc`).map(i)}async function w(a){let b=(0,d.f)(),c=(await b`
    select ${j(b)}, o.design_size, o.brief, o.brief_year, o.brief_reference, o.design_requirements,
           o.internal_notes, o.updated_at, o.completed_at, b.is_active as brand_is_active,
           o.design_order_type_id, o.brief_rich, o.drive_url, o.requester_message, o.result_url, o.requester_whatsapp,
           false as has_tracking,
           exists(select 1 from notification_outbox n where n.order_id = o.id and n.channel = 'telegram' and n.status = 'failed') as telegram_notify_failed
    from ${l(b)}
    where o.id = ${a}`)[0];if(!c)return null;let[e,f]=await Promise.all([b`
      select id, file_name, mime_type, file_size, created_at
      from order_attachments where order_id = ${a} and kind = 'reference' order by created_at, file_name`,b`
      select h.id, h.previous_status, h.new_status, h.changed_at, h.notes, u.full_name as changed_by_name,
             h.previous_status is null as is_first
      from order_status_history h left join app_users u on u.id = h.changed_by
      where h.order_id = ${a} order by h.changed_at desc, h.id desc`]);return{...i(c),designSize:c.design_size,brief:c.brief,briefYear:c.brief_year,briefReference:c.brief_reference,designRequirements:c.design_requirements,internalNotes:c.internal_notes,updatedAt:c.updated_at.toISOString(),completedAt:c.completed_at?.toISOString()??null,brandIsActive:c.brand_is_active,designOrderTypeId:c.design_order_type_id,teamId:c.team_id,briefRich:c.brief_rich??null,driveUrl:c.drive_url,requesterMessage:c.requester_message,resultUrl:c.result_url,requesterWhatsapp:c.requester_whatsapp,hasTrackingCode:!1,telegramNotifyFailed:c.telegram_notify_failed,attachments:e.map(a=>({id:a.id,fileName:a.file_name,mimeType:a.mime_type,fileSize:Number(a.file_size),createdAt:a.created_at.toISOString()})),history:f.map(a=>({id:a.id,previousStatus:a.previous_status,newStatus:a.new_status,changedAt:a.changed_at.toISOString(),notes:a.notes,actor:a.changed_by_name??(a.is_first?"Pemohon (form pengajuan)":"Sistem")}))}}async function x(a){let b=await (0,d.f)()`
    select l.id::text as id, l.action, l.created_at, u.full_name as actor_name, l.detail
    from auth_audit_log l left join app_users u on u.id = l.actor_user_id
    where l.action in ('order_pic_changed', 'order_deadline_changed') and l.detail->>'orderId' = ${a}
    order by l.created_at desc, l.id desc
    limit 30`,e=a=>Array.isArray(a)?a.filter(a=>"string"==typeof a):[];return b.map(a=>{let b=a.detail,d="string"==typeof b.actorName?b.actorName:a.actor_name,f="string"==typeof b.reason?b.reason:null;if("order_deadline_changed"===a.action){let e="string"==typeof b.previousDeadline?(0,c.Q)(b.previousDeadline):"—",g="string"==typeof b.newDeadline?(0,c.Q)(b.newDeadline):"—";return{id:a.id,kind:"deadline",at:a.created_at.toISOString(),actorName:d,summary:`Deadline diubah: ${e} → ${g}`,reason:f}}let g=e(b.before).join(", ")||"—",h=e(b.after).join(", ")||"—";return{id:a.id,kind:"pic",at:a.created_at.toISOString(),actorName:d,summary:`PIC diubah: ${g} → ${h}`,reason:f}})}a.s(["r",0,["overdue","today","week","month"],"P",0,["newest","oldest","deadline_asc","deadline_desc","qc_queue"],"J",0,h,"H",0,s,"z",0,l,"o",0,w,"n",0,t,"s",0,j,"p",0,x,"F",0,r,"_",0,v,"S",0,i,"w",0,q,"x",0,p])},5032,a=>{let b=a=>({required:!1,label:a}),c=a=>({required:!0,label:a}),d=[{from:"assigned",to:"in_progress",action:"Mulai kerjakan",actor:"pic",note:b("Catatan (opsional)"),notify:!0},{from:"in_progress",to:"on_hold",action:"Tunda pekerjaan",actor:"pic",note:c("Alasan penundaan"),notify:!0},{from:"on_hold",to:"in_progress",action:"Lanjutkan pekerjaan",actor:"pic",note:b("Catatan (opsional)"),notify:!1},{from:"internal_revision",to:"in_progress",action:"Perbaiki hasil",actor:"pic",note:b("Catatan (opsional)"),notify:!1},{from:"submitted",to:"assigned",action:"Tandai siap dikerjakan",actor:"super_admin",note:b("Catatan (opsional)"),notify:!1,requiresAssignee:!0},...["submitted","assigned","in_progress","internal_revision","awaiting_requester","on_hold","pending_confirmation"].map(a=>({from:a,to:"cancelled",action:"Batalkan request",actor:"super_admin",note:c("Alasan pembatalan"),notify:!0}))];a.s(["f",0,function(a,b){return d.filter(c=>c.from===a&&("super_admin"===b.role||"pic"===c.actor&&"staff"===b.role&&b.isAssignee))}])}]})();

//# sourceMappingURL=src_lib_1h7wb8a7u7fpn._.js.map