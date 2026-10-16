module.exports=[2838,t=>{"use strict";var e=t.i(29286),a=t.i(37333);async function n(t){return(await (0,e.B)()`
    update notification_outbox set status = 'processing', attempts = attempts + 1, locked_at = now()
    where id = ${t} and channel = 'telegram' and attempts < max_attempts and chat_id is not null and config_id is not null
      and ((status in ('pending', 'retrying') and next_attempt_at <= now())
           or (status = 'processing' and locked_at < now() - make_interval(secs => ${120})))
    returning id, kind, order_id, event_ref, attempts, max_attempts, chat_id, config_id`)[0]??null}async function r(t){return(0,e.B)()`
    update notification_outbox set status = 'processing', attempts = attempts + 1, locked_at = now()
    where id in (
      select id from notification_outbox
      where channel = 'telegram' and attempts < max_attempts and chat_id is not null and config_id is not null
        and ((status in ('pending', 'retrying') and next_attempt_at <= now())
             or (status = 'processing' and locked_at < now() - make_interval(secs => ${120})))
      order by next_attempt_at, created_at
      limit ${t}
      for update skip locked)
    returning id, kind, order_id, event_ref, attempts, max_attempts, chat_id, config_id`}async function i(t){return(0,e.B)()`
    select id, status, last_error from notification_outbox
    where channel = 'telegram' and kind = 'order_created' and order_id = ${t} and event_ref = ''`}async function d(t,a){let n=`manual:${a}`;return(0,e.B)().begin(async e=>{let a=await _(e,{orderId:t,kind:"order_created",eventType:"new_order",eventRef:n});if(a)return{id:a,created:!0};let[r]=await e`
      select id from notification_outbox where channel = 'telegram' and kind = 'order_created' and order_id = ${t} and event_ref = ${n}`;return{id:r.id,created:!1}})}async function o(t,e,n){let[r]=await t`select brand_id from orders where id = ${e}`,i=r?.brand_id??null,[d]=await t`
    select id, chat_id, is_active, verification_status, notify_new_order, notify_status_changed,
           notify_waiting_confirmation, notify_completed, notify_on_hold, notify_cancelled, notify_pic_changed
    from telegram_brand_channels where brand_id is null`,o=d?"verified"!==d.verification_status?"unverified":d.is_active?d[a.D[n]]?"ok":"event_disabled":"inactive":"no_channel",s=(0,a.Q)({group:o,eventType:n});if("send"===s)return{status:"pending",brandId:i,configId:d.id,chatId:d.chat_id,reason:null,destination:"global"};if("skip"===s){let t="event_disabled"===o?a.j.event_disabled:a.j.no_destination;return{status:"skipped",brandId:i,configId:d?.id??null,chatId:null,reason:t,destination:null}}return{status:"awaiting_destination",brandId:i,configId:null,chatId:null,reason:a.j.no_destination,destination:null}}async function s(t){return(0,e.B)().begin(e=>o(e,t,"new_order"))}async function l(t){let[a]=await (0,e.B)()`
    select id from notification_outbox
    where channel = 'telegram' and kind = 'order_created' and order_id = ${t} and status = 'awaiting_destination'
    order by created_at limit 1`;return a?.id??null}async function _(t,e){let a=await o(t,e.orderId,e.eventType),[n]=await t`
    insert into notification_outbox (channel, kind, order_id, event_ref, event_type, brand_id, config_id, chat_id, status, last_error)
    values ('telegram', ${e.kind}, ${e.orderId}, ${e.eventRef}, ${e.eventType}, ${a.brandId}, ${a.configId},
            ${a.chatId}, ${a.status}, ${a.reason})
    on conflict (channel, kind, order_id, event_ref) do nothing
    returning id`;return n?.id??null}async function u(t){let[a]=await (0,e.B)()`
    select is_active, chat_id, message_thread_id, verification_status, brand_id from telegram_brand_channels where id = ${t}`;return a?{isActive:a.is_active,verified:"verified"===a.verification_status,chatId:a.chat_id,threadId:a.message_thread_id,isDefault:null===a.brand_id}:null}async function c(t=50){return(0,e.B)().begin(async e=>{let a=await e`
      select n.id, n.order_id, n.event_type from notification_outbox n
      where n.channel = 'telegram' and n.status = 'awaiting_destination'
        and exists (
          select 1 from telegram_brand_channels c
          where c.brand_id is null and c.is_active and c.verification_status = 'verified' and c.notify_new_order)
      order by n.created_at limit ${t}
      for update of n skip locked`,n=0;for(let t of a){let a=await o(e,t.order_id,t.event_type??"new_order");"pending"===a.status&&(await e`
        update notification_outbox set status = 'pending', config_id = ${a.configId}, chat_id = ${a.chatId},
          brand_id = ${a.brandId}, last_error = null, error_kind = null, error_code = null, next_attempt_at = now()
        where id = ${t.id} and status = 'awaiting_destination'`,n++)}return n})}async function m(){let[t]=await (0,e.B)()`select count(*)::int as n from notification_outbox where channel = 'telegram' and status = 'awaiting_destination'`;return t?.n??0}async function f(t,a){await (0,e.B)()`update notification_outbox set status = 'skipped', last_error = ${a.slice(0,300)}, error_kind = null, locked_at = null where id = ${t}`}async function p(t){let[a]=await (0,e.B)()`
    select status, last_error, attempts, max_attempts, next_attempt_at, error_kind, sent_at from notification_outbox where id = ${t}`;return a?{status:a.status,lastError:a.last_error,attempts:a.attempts,maxAttempts:a.max_attempts,nextAttemptAt:a.next_attempt_at.toISOString(),errorKind:a.error_kind,sentAt:a.sent_at?.toISOString()??null}:null}async function g(t){await (0,e.B)()`update notification_outbox set status = 'sent', sent_at = now(), last_error = null, error_kind = null, error_code = null, locked_at = null where id = ${t}`}async function h(t,a,n,r=null){await (0,e.B)()`
    update notification_outbox set status = 'retrying', next_attempt_at = now() + make_interval(secs => ${a}),
      last_error = ${n.slice(0,300)}, error_kind = 'transient', error_code = ${r}, locked_at = null
    where id = ${t}`}async function w(t,a,n,r=null){await (0,e.B)()`update notification_outbox set status = 'failed', last_error = ${a.slice(0,300)}, error_kind = ${n}, error_code = ${r}, locked_at = null where id = ${t}`}async function b(t){return(await (0,e.B)()`
    update notification_outbox set
      status = 'pending',
      attempts = case when status = 'failed' then 0 else attempts end,
      next_attempt_at = now(), error_kind = null
    where id in (
      select id from notification_outbox
      where channel = 'telegram' and status in ('pending', 'retrying', 'failed')
      order by created_at limit ${t})
    returning id`).length}async function y(){let t=Object.fromEntries((await (0,e.B)()`
    select status, count(*)::int as n from notification_outbox where channel = 'telegram' group by status`).map(t=>[t.status,t.n])),a=await (0,e.B)()`
    select max(sent_at) as sent_at,
           max(updated_at) filter (where status = 'failed') as failed_at,
           (select last_error from notification_outbox where channel = 'telegram' and status in ('failed', 'retrying') order by updated_at desc limit 1) as last_error
    from notification_outbox where channel = 'telegram'`,n=await (0,e.B)()`
    select n.id, o.order_number, n.kind, n.status, n.attempts, n.max_attempts, n.next_attempt_at, n.error_kind, n.last_error, n.updated_at
    from notification_outbox n join orders o on o.id = n.order_id
    where n.channel = 'telegram'
    order by n.updated_at desc limit 15`;return{pending:t.pending??0,processing:t.processing??0,retrying:t.retrying??0,failed:t.failed??0,skipped:t.skipped??0,awaiting:t.awaiting_destination??0,sent:t.sent??0,lastSentAt:a[0]?.sent_at?.toISOString()??null,lastFailedAt:a[0]?.failed_at?.toISOString()??null,lastError:a[0]?.last_error??null,recent:n.map(t=>({id:t.id,orderNumber:t.order_number,kind:t.kind,status:t.status,attempts:t.attempts,maxAttempts:t.max_attempts,nextAttemptAt:t.next_attempt_at.toISOString(),errorKind:t.error_kind,lastError:t.last_error,updatedAt:t.updated_at.toISOString()}))}}let x=t=>({fullName:t.full_name,displayName:t.telegram_display_name,username:t.telegram_username,userId:t.telegram_user_id,status:t.telegram_status});async function $(t){if(0===t.length)return[];let a=(0,e.B)();return(await a`
    select full_name, telegram_display_name, telegram_username, telegram_user_id, telegram_status
    from dtic_members where id in ${a(t)} order by full_name`).map(x)}async function k(t,a){if(!/^\d{1,18}$/.test(a))return null;let[n]=await (0,e.B)()`
    select l.detail, l.created_at, u.full_name as actor_name, o.order_number, o.title, t.name as team_name
    from auth_audit_log l
    join orders o on o.id = ${t}
    left join app_users u on u.id = l.actor_user_id
    left join dtic_teams t on t.id = o.team_id
    where l.id = ${a}::bigint and l.action = 'order_pic_changed' and l.detail->>'orderId' = ${t}`;return n?{orderId:t,orderNumber:n.order_number,title:n.detail.title??n.title,operation:n.detail.operation??null,teamName:n.team_name,before:n.detail.before??[],after:n.detail.after??[],added:await $(n.detail.addedIds??[]),removed:n.detail.removed??[],reason:n.detail.reason??null,actorName:n.detail.actorName??n.actor_name,changedAt:n.created_at}:null}async function v(t){return(await (0,e.B)()`
    select m.full_name, m.telegram_display_name, m.telegram_username, m.telegram_user_id, m.telegram_status
    from order_assignments a join dtic_members m on m.id = a.member_id
    where a.order_id = ${t} order by a.assigned_at, m.full_name`).map(t=>({fullName:t.full_name,displayName:t.telegram_display_name,username:t.telegram_username,userId:t.telegram_user_id,status:t.telegram_status}))}async function I(t){let[a]=await (0,e.B)()`
    select o.id, o.order_number, o.status, o.created_at, o.requester_name, b.name as brand_name, tm.name as team_name,
           o.department, o.design_type, o.title, o.brief, p.name as priority_name, o.deadline_at,
           (select count(*)::int from order_attachments a where a.order_id = o.id and a.kind = 'reference') as attachment_count
    from orders o
    join brands b on b.id = o.brand_id
    left join dtic_teams tm on tm.id = o.team_id
    left join priority_levels p on p.code = o.priority
    where o.id = ${t}`;return a?{id:a.id,orderNumber:a.order_number,status:a.status,createdAt:a.created_at,requesterName:a.requester_name,department:a.department,brandName:a.brand_name,teamName:a.team_name,designType:a.design_type,title:a.title,brief:a.brief,priorityName:a.priority_name,deadlineAt:a.deadline_at,attachmentCount:a.attachment_count,picInfos:await v(a.id)}:null}async function B(t,a){let[n]=await (0,e.B)()`
    select o.id as order_id, o.order_number, o.title, h.previous_status, h.new_status, h.changed_at, h.notes, u.full_name as actor_name
    from order_status_history h
    join orders o on o.id = h.order_id
    left join app_users u on u.id = h.changed_by
    where h.id = ${a} and h.order_id = ${t}`;return n?{orderId:n.order_id,orderNumber:n.order_number,title:n.title,previousStatus:n.previous_status,newStatus:n.new_status,changedAt:n.changed_at,note:n.notes,actorName:n.actor_name,picInfos:await v(n.order_id)}:null}t.s(["P",0,l,"Q",0,r,"R",0,n,"h",0,m,"i",0,u,"j",0,_,"E",0,I,"T",0,k,"S",0,B,"v",0,w,"k",0,h,"g",0,g,"w",0,f,"l",0,i,"B",0,p,"c",0,c,"p",0,b,"O",0,s,"F",0,y,"x",0,d])}];

//# sourceMappingURL=src_lib_server_repositories_notifications_ts_1ma02r7-mqwzj._.js.map