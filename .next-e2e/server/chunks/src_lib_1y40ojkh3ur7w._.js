(()=>{"use strict";module.exports=[2838,e=>{var t=e.i(29286),n=e.i(37333);async function a(e){return(await (0,t.B)()`
    update notification_outbox set status = 'processing', attempts = attempts + 1, locked_at = now()
    where id = ${e} and channel = 'telegram' and attempts < max_attempts and chat_id is not null and config_id is not null
      and ((status in ('pending', 'retrying') and next_attempt_at <= now())
           or (status = 'processing' and locked_at < now() - make_interval(secs => ${120})))
    returning id, kind, order_id, event_ref, attempts, max_attempts, chat_id, config_id`)[0]??null}async function i(e){return(0,t.B)()`
    update notification_outbox set status = 'processing', attempts = attempts + 1, locked_at = now()
    where id in (
      select id from notification_outbox
      where channel = 'telegram' and attempts < max_attempts and chat_id is not null and config_id is not null
        and ((status in ('pending', 'retrying') and next_attempt_at <= now())
             or (status = 'processing' and locked_at < now() - make_interval(secs => ${120})))
      order by next_attempt_at, created_at
      limit ${e}
      for update skip locked)
    returning id, kind, order_id, event_ref, attempts, max_attempts, chat_id, config_id`}async function r(e){return(0,t.B)()`
    select id, status, last_error from notification_outbox
    where channel = 'telegram' and kind = 'order_created' and order_id = ${e} and event_ref = ''`}async function d(e,n){let a=`manual:${n}`;return(0,t.B)().begin(async t=>{let n=await u(t,{orderId:e,kind:"order_created",eventType:"new_order",eventRef:a});if(n)return{id:n,created:!0};let[i]=await t`
      select id from notification_outbox where channel = 'telegram' and kind = 'order_created' and order_id = ${e} and event_ref = ${a}`;return{id:i.id,created:!1}})}async function o(e,t,a){let[i]=await e`select brand_id from orders where id = ${t}`,r=i?.brand_id??null,[d]=await e`
    select id, chat_id, is_active, verification_status, notify_new_order, notify_status_changed,
           notify_waiting_confirmation, notify_completed, notify_on_hold, notify_cancelled, notify_pic_changed
    from telegram_brand_channels where brand_id is null`,o=d?"verified"!==d.verification_status?"unverified":d.is_active?d[n.D[a]]?"ok":"event_disabled":"inactive":"no_channel",s=(0,n.Q)({group:o,eventType:a});if("send"===s)return{status:"pending",brandId:r,configId:d.id,chatId:d.chat_id,reason:null,destination:"global"};if("skip"===s){let e="event_disabled"===o?n.j.event_disabled:n.j.no_destination;return{status:"skipped",brandId:r,configId:d?.id??null,chatId:null,reason:e,destination:null}}return{status:"awaiting_destination",brandId:r,configId:null,chatId:null,reason:n.j.no_destination,destination:null}}async function s(e){return(0,t.B)().begin(t=>o(t,e,"new_order"))}async function l(e){let[n]=await (0,t.B)()`
    select id from notification_outbox
    where channel = 'telegram' and kind = 'order_created' and order_id = ${e} and status = 'awaiting_destination'
    order by created_at limit 1`;return n?.id??null}async function u(e,t){let n=await o(e,t.orderId,t.eventType),[a]=await e`
    insert into notification_outbox (channel, kind, order_id, event_ref, event_type, brand_id, config_id, chat_id, status, last_error)
    values ('telegram', ${t.kind}, ${t.orderId}, ${t.eventRef}, ${t.eventType}, ${n.brandId}, ${n.configId},
            ${n.chatId}, ${n.status}, ${n.reason})
    on conflict (channel, kind, order_id, event_ref) do nothing
    returning id`;return a?.id??null}async function _(e){let[n]=await (0,t.B)()`
    select is_active, chat_id, message_thread_id, verification_status, brand_id from telegram_brand_channels where id = ${e}`;return n?{isActive:n.is_active,verified:"verified"===n.verification_status,chatId:n.chat_id,threadId:n.message_thread_id,isDefault:null===n.brand_id}:null}async function c(e=50){return(0,t.B)().begin(async t=>{let n=await t`
      select n.id, n.order_id, n.event_type from notification_outbox n
      where n.channel = 'telegram' and n.status = 'awaiting_destination'
        and exists (
          select 1 from telegram_brand_channels c
          where c.brand_id is null and c.is_active and c.verification_status = 'verified' and c.notify_new_order)
      order by n.created_at limit ${e}
      for update of n skip locked`,a=0;for(let e of n){let n=await o(t,e.order_id,e.event_type??"new_order");"pending"===n.status&&(await t`
        update notification_outbox set status = 'pending', config_id = ${n.configId}, chat_id = ${n.chatId},
          brand_id = ${n.brandId}, last_error = null, error_kind = null, error_code = null, next_attempt_at = now()
        where id = ${e.id} and status = 'awaiting_destination'`,a++)}return a})}async function m(){let[e]=await (0,t.B)()`select count(*)::int as n from notification_outbox where channel = 'telegram' and status = 'awaiting_destination'`;return e?.n??0}async function f(e,n){await (0,t.B)()`update notification_outbox set status = 'skipped', last_error = ${n.slice(0,300)}, error_kind = null, locked_at = null where id = ${e}`}async function p(e){let[n]=await (0,t.B)()`
    select status, last_error, attempts, max_attempts, next_attempt_at, error_kind, sent_at from notification_outbox where id = ${e}`;return n?{status:n.status,lastError:n.last_error,attempts:n.attempts,maxAttempts:n.max_attempts,nextAttemptAt:n.next_attempt_at.toISOString(),errorKind:n.error_kind,sentAt:n.sent_at?.toISOString()??null}:null}async function g(e){await (0,t.B)()`update notification_outbox set status = 'sent', sent_at = now(), last_error = null, error_kind = null, error_code = null, locked_at = null where id = ${e}`}async function h(e,n,a,i=null){await (0,t.B)()`
    update notification_outbox set status = 'retrying', next_attempt_at = now() + make_interval(secs => ${n}),
      last_error = ${a.slice(0,300)}, error_kind = 'transient', error_code = ${i}, locked_at = null
    where id = ${e}`}async function w(e,n,a,i=null){await (0,t.B)()`update notification_outbox set status = 'failed', last_error = ${n.slice(0,300)}, error_kind = ${a}, error_code = ${i}, locked_at = null where id = ${e}`}async function b(e){return(await (0,t.B)()`
    update notification_outbox set
      status = 'pending',
      attempts = case when status = 'failed' then 0 else attempts end,
      next_attempt_at = now(), error_kind = null
    where id in (
      select id from notification_outbox
      where channel = 'telegram' and status in ('pending', 'retrying', 'failed')
      order by created_at limit ${e})
    returning id`).length}async function y(){let e=Object.fromEntries((await (0,t.B)()`
    select status, count(*)::int as n from notification_outbox where channel = 'telegram' group by status`).map(e=>[e.status,e.n])),n=await (0,t.B)()`
    select max(sent_at) as sent_at,
           max(updated_at) filter (where status = 'failed') as failed_at,
           (select last_error from notification_outbox where channel = 'telegram' and status in ('failed', 'retrying') order by updated_at desc limit 1) as last_error
    from notification_outbox where channel = 'telegram'`,a=await (0,t.B)()`
    select n.id, o.order_number, n.kind, n.status, n.attempts, n.max_attempts, n.next_attempt_at, n.error_kind, n.last_error, n.updated_at
    from notification_outbox n join orders o on o.id = n.order_id
    where n.channel = 'telegram'
    order by n.updated_at desc limit 15`;return{pending:e.pending??0,processing:e.processing??0,retrying:e.retrying??0,failed:e.failed??0,skipped:e.skipped??0,awaiting:e.awaiting_destination??0,sent:e.sent??0,lastSentAt:n[0]?.sent_at?.toISOString()??null,lastFailedAt:n[0]?.failed_at?.toISOString()??null,lastError:n[0]?.last_error??null,recent:a.map(e=>({id:e.id,orderNumber:e.order_number,kind:e.kind,status:e.status,attempts:e.attempts,maxAttempts:e.max_attempts,nextAttemptAt:e.next_attempt_at.toISOString(),errorKind:e.error_kind,lastError:e.last_error,updatedAt:e.updated_at.toISOString()}))}}let k=e=>({fullName:e.full_name,displayName:e.telegram_display_name,username:e.telegram_username,userId:e.telegram_user_id,status:e.telegram_status});async function v(e){if(0===e.length)return[];let n=(0,t.B)();return(await n`
    select full_name, telegram_display_name, telegram_username, telegram_user_id, telegram_status
    from dtic_members where id in ${n(e)} order by full_name`).map(k)}async function x(e,n){if(!/^\d{1,18}$/.test(n))return null;let[a]=await (0,t.B)()`
    select l.detail, l.created_at, u.full_name as actor_name, o.order_number, o.title, t.name as team_name
    from auth_audit_log l
    join orders o on o.id = ${e}
    left join app_users u on u.id = l.actor_user_id
    left join dtic_teams t on t.id = o.team_id
    where l.id = ${n}::bigint and l.action = 'order_pic_changed' and l.detail->>'orderId' = ${e}`;return a?{orderId:e,orderNumber:a.order_number,title:a.detail.title??a.title,operation:a.detail.operation??null,teamName:a.team_name,before:a.detail.before??[],after:a.detail.after??[],added:await v(a.detail.addedIds??[]),removed:a.detail.removed??[],reason:a.detail.reason??null,actorName:a.detail.actorName??a.actor_name,changedAt:a.created_at}:null}async function $(e){return(await (0,t.B)()`
    select m.full_name, m.telegram_display_name, m.telegram_username, m.telegram_user_id, m.telegram_status
    from order_assignments a join dtic_members m on m.id = a.member_id
    where a.order_id = ${e} order by a.assigned_at, m.full_name`).map(e=>({fullName:e.full_name,displayName:e.telegram_display_name,username:e.telegram_username,userId:e.telegram_user_id,status:e.telegram_status}))}async function I(e){let[n]=await (0,t.B)()`
    select o.id, o.order_number, o.status, o.created_at, o.requester_name, b.name as brand_name, tm.name as team_name,
           o.department, o.design_type, o.title, o.brief, p.name as priority_name, o.deadline_at,
           (select count(*)::int from order_attachments a where a.order_id = o.id and a.kind = 'reference') as attachment_count
    from orders o
    join brands b on b.id = o.brand_id
    left join dtic_teams tm on tm.id = o.team_id
    left join priority_levels p on p.code = o.priority
    where o.id = ${e}`;return n?{id:n.id,orderNumber:n.order_number,status:n.status,createdAt:n.created_at,requesterName:n.requester_name,department:n.department,brandName:n.brand_name,teamName:n.team_name,designType:n.design_type,title:n.title,brief:n.brief,priorityName:n.priority_name,deadlineAt:n.deadline_at,attachmentCount:n.attachment_count,picInfos:await $(n.id)}:null}async function B(e,n){let[a]=await (0,t.B)()`
    select o.id as order_id, o.order_number, o.title, h.previous_status, h.new_status, h.changed_at, h.notes, u.full_name as actor_name
    from order_status_history h
    join orders o on o.id = h.order_id
    left join app_users u on u.id = h.changed_by
    where h.id = ${n} and h.order_id = ${e}`;return a?{orderId:a.order_id,orderNumber:a.order_number,title:a.title,previousStatus:a.previous_status,newStatus:a.new_status,changedAt:a.changed_at,note:a.notes,actorName:a.actor_name,picInfos:await $(a.order_id)}:null}e.s(["P",0,l,"Q",0,i,"R",0,a,"h",0,m,"i",0,_,"j",0,u,"E",0,I,"T",0,x,"S",0,B,"v",0,w,"k",0,h,"g",0,g,"w",0,f,"l",0,r,"B",0,p,"c",0,c,"p",0,b,"O",0,s,"F",0,y,"x",0,d])},97867,e=>{let t=["submitted","assigned","in_progress","pending_confirmation","internal_revision","awaiting_requester","on_hold","completed","cancelled"],n={submitted:{label:"Pengajuan Masuk",tone:"neutral",description:"Pengajuan tersimpan dan belum memiliki PIC (data lama)."},assigned:{label:"Siap Dikerjakan",tone:"accent",description:"PIC sudah dipilih pemohon; tugas siap dikerjakan."},in_progress:{label:"Sedang Dikerjakan",tone:"info",description:"Staff sedang mengerjakan request."},pending_confirmation:{label:"Menunggu QC Manager",tone:"violet",description:"Hasil diserahkan dan menunggu pemeriksaan QC Manager."},internal_revision:{label:"Perlu Revisi Internal",tone:"danger",description:"Manager meminta perbaikan sebelum hasil dapat dilanjutkan."},awaiting_requester:{label:"Menunggu Masukan Pemohon",tone:"warning",description:"Hasil sudah dikirim ke pemohon; menunggu tanggapan."},on_hold:{label:"Ditunda",tone:"warning",description:"Pekerjaan dihentikan sementara (alasan tercatat)."},completed:{label:"Selesai",tone:"success",description:"Hasil dikonfirmasi dan request ditutup."},cancelled:{label:"Dibatalkan",tone:"muted",description:"Request dibatalkan (alasan tercatat)."}},a=["completed","cancelled"],i=["new_request","need_information","queued","review","revision","closed"],r={new_request:"Request Baru (lama)",need_information:"Perlu Informasi (lama)",queued:"Antrean (lama)",review:"Review (lama)",revision:"Revisi (lama)",closed:"Ditutup (lama)"},d={new_request:"submitted",need_information:"on_hold",queued:"assigned",review:"pending_confirmation",revision:"in_progress",closed:"completed"};function o(e){return"string"==typeof e&&t.includes(e)}function s(e){return"string"==typeof e&&i.includes(e)}t.filter(e=>!a.includes(e)),e.s(["S",0,a,"v",0,t,"y",0,n,"W",0,function(e){return a.includes(e)},"g",0,function(e){return o(e)?n[e].label:s(e)?r[e]:e},"u",0,function(e){return o(e)?e:s(e)?d[e]:null}])}]})();

//# sourceMappingURL=src_lib_1y40ojkh3ur7w._.js.map