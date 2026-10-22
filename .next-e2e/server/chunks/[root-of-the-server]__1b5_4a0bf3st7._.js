module.exports=[54799,(e,r,t)=>{r.exports=e.x("crypto",()=>require("crypto"))},22734,(e,r,t)=>{r.exports=e.x("fs",()=>require("fs"))},4446,(e,r,t)=>{r.exports=e.x("net",()=>require("net"))},70406,(e,r,t)=>{r.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},18622,(e,r,t)=>{r.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,r,t)=>{r.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,r,t)=>{r.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},59043,(e,r,t)=>{r.exports=e.x("next/dist/server/runtime-reacts.external.js",()=>require("next/dist/server/runtime-reacts.external.js"))},93695,(e,r,t)=>{r.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},81111,(e,r,t)=>{r.exports=e.x("node:stream",()=>require("node:stream"))},46786,(e,r,t)=>{r.exports=e.x("os",()=>require("os"))},14747,(e,r,t)=>{r.exports=e.x("path",()=>require("path"))},60438,(e,r,t)=>{r.exports=e.x("perf_hooks",()=>require("perf_hooks"))},88947,(e,r,t)=>{r.exports=e.x("stream",()=>require("stream"))},55004,(e,r,t)=>{r.exports=e.x("tls",()=>require("tls"))},49057,e=>{"use strict";var r=e.i(29286);let t=(e,r)=>({id:e.id,orderNumber:e.order_number,title:e.title,designType:e.design_type,brandName:e.brand_name,requesterName:e.requester_name,createdAt:e.created_at.toISOString(),picNames:e.pic_names??[],status:e.status,priorityName:e.priority_name,priorityTone:e.priority_tone,deadlineAt:e.deadline_at.toISOString(),overdue:e.deadline_at.getTime()<r.getTime()&&"completed"!==e.status&&"cancelled"!==e.status,updatedAt:e.updated_at.toISOString()}),s=e=>e`
  select o.id, o.order_number, o.title, o.design_type, b.name as brand_name, o.requester_name, o.created_at, o.status,
         p.name as priority_name, p.tone as priority_tone, p.sort_order as priority_rank,
         o.deadline_at, o.updated_at, o.completed_at,
         (select array_agg(m.full_name order by a.assigned_at, m.full_name)
            from order_assignments a join dtic_members m on m.id = a.member_id where a.order_id = o.id) as pic_names
  from orders o
  join brands b on b.id = o.brand_id
  left join priority_levels p on p.code = o.priority`;async function a(e,a){let i=(0,r.B)(),o=await i`
    ${s(i)}
    where o.status in ('submitted', 'assigned', 'in_progress', 'pending_confirmation', 'internal_revision', 'awaiting_requester', 'on_hold')
    ${e?e.memberId?i`and exists (select 1 from order_assignments sa where sa.order_id = o.id and sa.member_id = ${e.memberId})`:i`and false`:i``}
    order by o.deadline_at asc
    limit 400`,n=await i`
    ${s(i)}
    where o.status = 'completed'
    ${e?e.memberId?i`and exists (select 1 from order_assignments sa where sa.order_id = o.id and sa.member_id = ${e.memberId})`:i`and false`:i``}
    order by o.completed_at desc nulls last
    limit ${12}`,d=o.filter(e=>"submitted"===e.status||"assigned"===e.status).sort((e,r)=>(r.priority_rank??0)-(e.priority_rank??0)||e.deadline_at.getTime()-r.deadline_at.getTime()||e.updated_at.getTime()-r.updated_at.getTime()),p=o.filter(e=>"in_progress"===e.status||"internal_revision"===e.status||"awaiting_requester"===e.status),m=[...o.filter(e=>"pending_confirmation"===e.status),...n];return{now:a.toISOString(),queue:{total:d.length,items:d.map(e=>t(e,a))},inProgress:{total:p.length,items:p.map(e=>t(e,a))},done:{total:m.length,items:m.map(e=>t(e,a))},onHold:o.filter(e=>"on_hold"===e.status).length}}e.s(["f",0,a])}];

//# sourceMappingURL=%5Broot-of-the-server%5D__1b5_4a0bf3st7._.js.map