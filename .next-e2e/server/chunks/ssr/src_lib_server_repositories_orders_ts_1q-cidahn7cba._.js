module.exports=[86326,5032,a=>{"use strict";var b=a.i(22126),c=a.i(90428),d=a.i(14766),e=a.i(84896);let f=a=>({required:!1,label:a}),g=a=>({required:!0,label:a}),h=[{from:"assigned",to:"in_progress",action:"Mulai kerjakan",actor:"pic",note:f("Catatan (opsional)"),notify:!0},{from:"in_progress",to:"on_hold",action:"Tunda pekerjaan",actor:"pic",note:g("Alasan penundaan"),notify:!0},{from:"on_hold",to:"in_progress",action:"Lanjutkan pekerjaan",actor:"pic",note:f("Catatan (opsional)"),notify:!1},{from:"in_progress",to:"pending_confirmation",action:"Serahkan hasil untuk konfirmasi",actor:"pic",note:f("Catatan hasil (opsional)"),notify:!0},{from:"pending_confirmation",to:"completed",action:"Konfirmasi selesai",actor:"super_admin",note:f("Catatan (opsional)"),notify:!0},{from:"pending_confirmation",to:"in_progress",action:"Minta revisi",actor:"super_admin",note:g("Catatan revisi"),notify:!0},{from:"submitted",to:"assigned",action:"Tandai siap dikerjakan",actor:"super_admin",note:f("Catatan (opsional)"),notify:!1,requiresAssignee:!0},...["submitted","assigned","in_progress","on_hold","pending_confirmation"].map(a=>({from:a,to:"cancelled",action:"Batalkan request",actor:"super_admin",note:g("Alasan pembatalan"),notify:!0}))];a.s(["f",0,function(a,b){return h.filter(c=>c.from===a&&("super_admin"===b.role||"pic"===c.actor&&"staff"===b.role&&b.isAssignee))}],5032),a.i(25251),a.i(78160);let i=e.S;function j(a){return{id:a.id,orderNumber:a.order_number,requesterName:a.requester_name,company:a.company,department:a.department,title:a.title,designType:a.design_type,brandId:a.brand_id,brandName:a.brand_name,deadlineAt:a.deadline_at.toISOString(),priority:a.priority,priorityName:a.priority_name,priorityTone:a.priority_tone,status:a.status,createdAt:a.created_at.toISOString(),teamId:a.team_id??null,teamName:a.team_name??null,assignees:Array.isArray(a.assignees)?a.assignees:[]}}function k(a){return a`o.id, o.order_number, o.requester_name, o.company, o.department, o.title, o.design_type,
            o.brand_id, b.name as brand_name, o.deadline_at, o.priority, p.name as priority_name,
            p.tone as priority_tone, o.status, o.created_at,
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
            ), '[]'::json) as assignees`}function l(a,b){return b?"none"===b?a`and not exists (select 1 from order_assignments a where a.order_id = o.id)`:a`and exists (select 1 from order_assignments a where a.order_id = o.id and a.member_id = ${b})`:a``}function m(a){return a`orders o join brands b on b.id = o.brand_id join priority_levels p on p.code = o.priority`}function n(a){return a.replace(/[\\%_]/g,a=>`\\${a}`)}let o={newest:"o.created_at desc, o.order_number desc",oldest:"o.created_at asc, o.order_number asc",deadline_asc:"o.deadline_at asc, o.created_at asc",deadline_desc:"o.deadline_at desc, o.created_at desc"};function p(a,b){return b?b.memberId?a`and exists (select 1 from order_assignments sa where sa.order_id = o.id and sa.member_id = ${b.memberId})`:a`and false`:a``}async function q(a,e=new Date){let f=(0,d.f)(),g=Math.max(1,a.page??1),h=(g-1)*b.z,r=a.q?.trim(),s=r?`%${n(r)}%`:null,t=a.deadline?function(a,b){let d=(0,c.j)(b);switch(a){case"overdue":return{overdue:!0};case"today":return{from:(0,c.P)(d),to:(0,c.P)((0,c.s)(d,1))};case"week":return{from:(0,c.P)(d),to:(0,c.P)((0,c.s)(d,7))};case"month":{let[a,b]=d.split("-").map(Number),e=`${a}-${String(b).padStart(2,"0")}-01`,f=12===b?`${a+1}-01-01`:`${a}-${String(b+1).padStart(2,"0")}-01`;return{from:(0,c.P)(e),to:(0,c.P)(f)}}}}(a.deadline,e):null,u=f`
    where true
    ${s?f`and (o.order_number ilike ${s} or o.requester_name ilike ${s}
               or o.company ilike ${s} or b.name ilike ${s} or o.title ilike ${s})`:f``}
    ${a.brandId?f`and o.brand_id = ${a.brandId}`:f``}
    ${a.statuses?.length?f`and o.status in ${f(a.statuses)}`:f``}
    ${a.from?f`and o.created_at >= ${a.from}`:f``}
    ${a.to?f`and o.created_at < ${a.to}`:f``}
    ${a.teamId?f`and coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id)) = ${a.teamId}`:f``}
    ${a.priority?f`and o.priority = ${a.priority}`:f``}
    ${l(f,a.assignee)}
    ${p(f,a.scope)}
    ${t?.overdue?f`and o.deadline_at < ${e} and o.status not in ${f(i)}`:f``}
    ${t?.from?f`and o.deadline_at >= ${t.from}`:f``}
    ${t?.to?f`and o.deadline_at < ${t.to}`:f``}`,[v,[{total:w}]]=await Promise.all([f`
      select ${k(f)}
      from ${m(f)}
      ${u}
      order by ${f.unsafe(o[a.sort??"newest"])}
      limit ${b.z} offset ${h}`,f`select count(*)::int as total from ${m(f)} ${u}`]);return{items:v.map(j),total:w,page:g,pageSize:b.z}}async function r(a={}){let b=(0,d.f)(),c=a.q?.trim(),e=c?`%${n(c)}%`:null;return(await b`
    select ${k(b)}
    from ${m(b)}
    where true
    ${a.brandId?b`and o.brand_id = ${a.brandId}`:b``}
    ${l(b,a.assignee)}
    ${p(b,a.scope)}
    ${e?b`and (o.order_number ilike ${e} or o.title ilike ${e} or o.requester_name ilike ${e})`:b``}
    order by o.deadline_at asc
    limit 1000`).map(j)}let s="Asia/Jakarta";async function t(a){let b=(0,d.f)();return(await b`
    select ${k(b)}
    from ${m(b)}
    where o.deadline_at >= ${a.from} and o.deadline_at < ${a.to}
    ${function(a,b,c,d=new Date){let e=b.q?.trim()?`%${n(b.q.trim())}%`:null;return a`
    ${b.brandId?a`and o.brand_id = ${b.brandId}`:a``}
    ${b.teamId?a`and coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id)) = ${b.teamId}`:a``}
    ${b.typeId?a`and o.design_order_type_id = ${b.typeId}`:a``}
    ${e?a`and (o.title ilike ${e} or o.order_number ilike ${e} or o.requester_name ilike ${e})`:a``}
    ${b.overdue?a`and o.deadline_at < ${d} and o.status not in ${a(i)}`:a``}
    ${b.status?a`and o.status = ${b.status}`:a``}
    ${b.priority?a`and o.priority = ${b.priority}`:a``}
    ${"none"===b.pic?a`and not exists (select 1 from order_assignments a where a.order_id = o.id)`:b.pic?a`and exists (select 1 from order_assignments a where a.order_id = o.id and a.member_id = ${b.pic})`:a``}
    ${b.fromKey?a`and (o.deadline_at at time zone ${s})::date >= ${b.fromKey}::date`:a``}
    ${b.toKey?a`and (o.deadline_at at time zone ${s})::date <= ${b.toKey}::date`:a``}
    ${p(a,c)}`}(b,a,a.scope)}
    order by o.deadline_at asc`).map(j)}async function u(a){let b=(0,d.f)(),c=(await b`
    select ${k(b)}, o.design_size, o.brief, o.brief_year, o.brief_reference, o.design_requirements,
           o.internal_notes, o.updated_at, o.completed_at, b.is_active as brand_is_active,
           o.design_order_type_id, o.brief_rich, o.drive_url, o.requester_message, o.result_url, o.requester_whatsapp,
           false as has_tracking
    from ${m(b)}
    where o.id = ${a}`)[0];if(!c)return null;let[e,f]=await Promise.all([b`
      select id, file_name, mime_type, file_size, created_at
      from order_attachments where order_id = ${a} order by created_at, file_name`,b`
      select h.id, h.previous_status, h.new_status, h.changed_at, h.notes, u.full_name as changed_by_name,
             h.previous_status is null as is_first
      from order_status_history h left join app_users u on u.id = h.changed_by
      where h.order_id = ${a} order by h.changed_at desc, h.id desc`]);return{...j(c),designSize:c.design_size,brief:c.brief,briefYear:c.brief_year,briefReference:c.brief_reference,designRequirements:c.design_requirements,internalNotes:c.internal_notes,updatedAt:c.updated_at.toISOString(),completedAt:c.completed_at?.toISOString()??null,brandIsActive:c.brand_is_active,designOrderTypeId:c.design_order_type_id,teamId:c.team_id,briefRich:c.brief_rich??null,driveUrl:c.drive_url,requesterMessage:c.requester_message,resultUrl:c.result_url,requesterWhatsapp:c.requester_whatsapp,hasTrackingCode:!1,attachments:e.map(a=>({id:a.id,fileName:a.file_name,mimeType:a.mime_type,fileSize:Number(a.file_size),createdAt:a.created_at.toISOString()})),history:f.map(a=>({id:a.id,previousStatus:a.previous_status,newStatus:a.new_status,changedAt:a.changed_at.toISOString(),notes:a.notes,actor:a.changed_by_name??(a.is_first?"Pemohon (form pengajuan)":"Sistem")}))}}a.s(["r",0,["overdue","today","week","month"],"P",0,["newest","oldest","deadline_asc","deadline_desc"],"z",0,m,"o",0,u,"n",0,r,"s",0,k,"F",0,q,"_",0,t,"S",0,j,"x",0,p],86326)}];

//# sourceMappingURL=src_lib_server_repositories_orders_ts_1q-cidahn7cba._.js.map