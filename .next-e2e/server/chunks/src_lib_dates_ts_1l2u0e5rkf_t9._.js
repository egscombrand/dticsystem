module.exports=[10222,45171,97867,2838,e=>{"use strict";let t="Asia/Jakarta",n="id-ID";e.s(["V",0,n,"$",0,t,"d",0,{maxFiles:5,maxFileSizeBytes:0xa00000,maxTotalBytes:0x1900000}],45171);let a=new Map;function i(e,n=t){let r,o={};for(let t of(!(r=a.get(n))&&(r=new Intl.DateTimeFormat("en-US",{timeZone:n,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}),a.set(n,r)),r).formatToParts(e))"literal"!==t.type&&(o[t.type]=Number(t.value));return{year:o.year,month:o.month,day:o.day,hour:24===o.hour?0:o.hour,minute:o.minute,second:o.second}}function r(e,t){let n=i(e,t);return Date.UTC(n.year,n.month-1,n.day,n.hour,n.minute,n.second)-1e3*Math.floor(e.getTime()/1e3)}let o=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,d=/^(\d{4})-(\d{2})-(\d{2})$/;function s(e,n=t){let a=o.exec(e.trim());if(!a)return null;let[i,d,l,u,_,m]=[a[1],a[2],a[3],a[4],a[5],a[6]??"0"].map(Number);if(d<1||d>12||l<1||l>31||u>23||_>59||m>59)return null;let c=Date.UTC(i,d-1,l,u,_,m),f=new Date(c);if(f.getUTCFullYear()!==i||f.getUTCMonth()!==d-1||f.getUTCDate()!==l)return null;let p=c-r(new Date(c),n),g=c-r(new Date(p),n);return g!==p&&(p=g),new Date(p)}let l=(e,t=2)=>String(e).padStart(t,"0"),u=new Intl.DateTimeFormat(n,{timeZone:t,day:"numeric",month:"short",year:"numeric"}),_=new Intl.DateTimeFormat(n,{timeZone:t,day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});function m(e){return`${_.format(new Date(e))} WIB`}new Intl.DateTimeFormat(n,{timeZone:t,weekday:"long",day:"numeric",month:"long",year:"numeric"}),new Intl.DateTimeFormat(n,{timeZone:"UTC",month:"long",year:"numeric"}),e.s(["d",0,function(e,n=t){return d.test(e)?s(`${e}T23:59`,n):null},"r",0,m,"Q",0,function(e){let t=i(new Date(e));return 23===t.hour&&59===t.minute?u.format(new Date(e)):m(e)},"j",0,function(e,n=t){let a=i(new Date(e),n);return`${a.year}-${l(a.month)}-${l(a.day)}`},"t",0,s],10222);let c=["submitted","assigned","in_progress","pending_confirmation","on_hold","completed","cancelled"],f={submitted:{label:"Pengajuan Masuk",tone:"neutral",description:"Pengajuan tersimpan dan belum memiliki PIC (data lama)."},assigned:{label:"Siap Dikerjakan",tone:"accent",description:"PIC sudah dipilih pemohon; tugas siap dikerjakan."},in_progress:{label:"Sedang Dikerjakan",tone:"info",description:"Staff sedang mengerjakan request."},pending_confirmation:{label:"Menunggu Konfirmasi",tone:"warning",description:"Hasil sudah diserahkan dan menunggu konfirmasi."},on_hold:{label:"Ditunda",tone:"warning",description:"Pekerjaan dihentikan sementara (alasan tercatat)."},completed:{label:"Selesai",tone:"success",description:"Hasil dikonfirmasi dan request ditutup."},cancelled:{label:"Dibatalkan",tone:"muted",description:"Request dibatalkan (alasan tercatat)."}},p=["completed","cancelled"],g=["new_request","need_information","queued","review","revision","closed"],h={new_request:"Request Baru (lama)",need_information:"Perlu Informasi (lama)",queued:"Antrean (lama)",review:"Review (lama)",revision:"Revisi (lama)",closed:"Ditutup (lama)"},w={new_request:"submitted",need_information:"on_hold",queued:"assigned",review:"pending_confirmation",revision:"in_progress",closed:"completed"};function y(e){return"string"==typeof e&&c.includes(e)}function b(e){return"string"==typeof e&&g.includes(e)}c.filter(e=>!p.includes(e)).join(","),e.s(["S",0,p,"v",0,c,"y",0,f,"W",0,function(e){return p.includes(e)},"g",0,function(e){return y(e)?f[e].label:b(e)?h[e]:e},"u",0,function(e){return y(e)?e:b(e)?w[e]:null}],97867);var k=e.i(29286),v=e.i(37333);async function $(e){return(await (0,k.B)()`
    update notification_outbox set status = 'processing', attempts = attempts + 1, locked_at = now()
    where id = ${e} and channel = 'telegram' and attempts < max_attempts and chat_id is not null and config_id is not null
      and ((status in ('pending', 'retrying') and next_attempt_at <= now())
           or (status = 'processing' and locked_at < now() - make_interval(secs => ${120})))
    returning id, kind, order_id, event_ref, attempts, max_attempts, chat_id, config_id`)[0]??null}async function x(e){return(0,k.B)()`
    update notification_outbox set status = 'processing', attempts = attempts + 1, locked_at = now()
    where id in (
      select id from notification_outbox
      where channel = 'telegram' and attempts < max_attempts and chat_id is not null and config_id is not null
        and ((status in ('pending', 'retrying') and next_attempt_at <= now())
             or (status = 'processing' and locked_at < now() - make_interval(secs => ${120})))
      order by next_attempt_at, created_at
      limit ${e}
      for update skip locked)
    returning id, kind, order_id, event_ref, attempts, max_attempts, chat_id, config_id`}async function I(e){return(0,k.B)()`
    select id, status, last_error from notification_outbox
    where channel = 'telegram' and kind = 'order_created' and order_id = ${e} and event_ref = ''`}async function B(e,t){let n=`manual:${t}`;return(0,k.B)().begin(async t=>{let a=await T(t,{orderId:e,kind:"order_created",eventType:"new_order",eventRef:n});if(a)return{id:a,created:!0};let[i]=await t`
      select id from notification_outbox where channel = 'telegram' and kind = 'order_created' and order_id = ${e} and event_ref = ${n}`;return{id:i.id,created:!1}})}async function S(e,t,n){let[a]=await e`select brand_id from orders where id = ${t}`,i=a?.brand_id??null,[r]=await e`
    select id, chat_id, is_active, verification_status, notify_new_order, notify_status_changed,
           notify_waiting_confirmation, notify_completed, notify_on_hold, notify_cancelled, notify_pic_changed
    from telegram_brand_channels where brand_id is null`,o=r?"verified"!==r.verification_status?"unverified":r.is_active?r[v.D[n]]?"ok":"event_disabled":"inactive":"no_channel",d=(0,v.Q)({group:o,eventType:n});if("send"===d)return{status:"pending",brandId:i,configId:r.id,chatId:r.chat_id,reason:null,destination:"global"};if("skip"===d){let e="event_disabled"===o?v.j.event_disabled:v.j.no_destination;return{status:"skipped",brandId:i,configId:r?.id??null,chatId:null,reason:e,destination:null}}return{status:"awaiting_destination",brandId:i,configId:null,chatId:null,reason:v.j.no_destination,destination:null}}async function j(e){return(0,k.B)().begin(t=>S(t,e,"new_order"))}async function D(e){let[t]=await (0,k.B)()`
    select id from notification_outbox
    where channel = 'telegram' and kind = 'order_created' and order_id = ${e} and status = 'awaiting_destination'
    order by created_at limit 1`;return t?.id??null}async function T(e,t){let n=await S(e,t.orderId,t.eventType),[a]=await e`
    insert into notification_outbox (channel, kind, order_id, event_ref, event_type, brand_id, config_id, chat_id, status, last_error)
    values ('telegram', ${t.kind}, ${t.orderId}, ${t.eventRef}, ${t.eventType}, ${n.brandId}, ${n.configId},
            ${n.chatId}, ${n.status}, ${n.reason})
    on conflict (channel, kind, order_id, event_ref) do nothing
    returning id`;return a?.id??null}async function N(e){let[t]=await (0,k.B)()`
    select is_active, chat_id, message_thread_id, verification_status, brand_id from telegram_brand_channels where id = ${e}`;return t?{isActive:t.is_active,verified:"verified"===t.verification_status,chatId:t.chat_id,threadId:t.message_thread_id,isDefault:null===t.brand_id}:null}async function A(e=50){return(0,k.B)().begin(async t=>{let n=await t`
      select n.id, n.order_id, n.event_type from notification_outbox n
      where n.channel = 'telegram' and n.status = 'awaiting_destination'
        and exists (
          select 1 from telegram_brand_channels c
          where c.brand_id is null and c.is_active and c.verification_status = 'verified' and c.notify_new_order)
      order by n.created_at limit ${e}
      for update of n skip locked`,a=0;for(let e of n){let n=await S(t,e.order_id,e.event_type??"new_order");"pending"===n.status&&(await t`
        update notification_outbox set status = 'pending', config_id = ${n.configId}, chat_id = ${n.chatId},
          brand_id = ${n.brandId}, last_error = null, error_kind = null, error_code = null, next_attempt_at = now()
        where id = ${e.id} and status = 'awaiting_destination'`,a++)}return a})}async function q(){let[e]=await (0,k.B)()`select count(*)::int as n from notification_outbox where channel = 'telegram' and status = 'awaiting_destination'`;return e?.n??0}async function C(e,t){await (0,k.B)()`update notification_outbox set status = 'skipped', last_error = ${t.slice(0,300)}, error_kind = null, locked_at = null where id = ${e}`}async function F(e){let[t]=await (0,k.B)()`
    select status, last_error, attempts, max_attempts, next_attempt_at, error_kind, sent_at from notification_outbox where id = ${e}`;return t?{status:t.status,lastError:t.last_error,attempts:t.attempts,maxAttempts:t.max_attempts,nextAttemptAt:t.next_attempt_at.toISOString(),errorKind:t.error_kind,sentAt:t.sent_at?.toISOString()??null}:null}async function O(e){await (0,k.B)()`update notification_outbox set status = 'sent', sent_at = now(), last_error = null, error_kind = null, error_code = null, locked_at = null where id = ${e}`}async function P(e,t,n,a=null){await (0,k.B)()`
    update notification_outbox set status = 'retrying', next_attempt_at = now() + make_interval(secs => ${t}),
      last_error = ${n.slice(0,300)}, error_kind = 'transient', error_code = ${a}, locked_at = null
    where id = ${e}`}async function U(e,t,n,a=null){await (0,k.B)()`update notification_outbox set status = 'failed', last_error = ${t.slice(0,300)}, error_kind = ${n}, error_code = ${a}, locked_at = null where id = ${e}`}async function R(e){return(await (0,k.B)()`
    update notification_outbox set
      status = 'pending',
      attempts = case when status = 'failed' then 0 else attempts end,
      next_attempt_at = now(), error_kind = null
    where id in (
      select id from notification_outbox
      where channel = 'telegram' and status in ('pending', 'retrying', 'failed')
      order by created_at limit ${e})
    returning id`).length}async function E(){let e=Object.fromEntries((await (0,k.B)()`
    select status, count(*)::int as n from notification_outbox where channel = 'telegram' group by status`).map(e=>[e.status,e.n])),t=await (0,k.B)()`
    select max(sent_at) as sent_at,
           max(updated_at) filter (where status = 'failed') as failed_at,
           (select last_error from notification_outbox where channel = 'telegram' and status in ('failed', 'retrying') order by updated_at desc limit 1) as last_error
    from notification_outbox where channel = 'telegram'`,n=await (0,k.B)()`
    select n.id, o.order_number, n.kind, n.status, n.attempts, n.max_attempts, n.next_attempt_at, n.error_kind, n.last_error, n.updated_at
    from notification_outbox n join orders o on o.id = n.order_id
    where n.channel = 'telegram'
    order by n.updated_at desc limit 15`;return{pending:e.pending??0,processing:e.processing??0,retrying:e.retrying??0,failed:e.failed??0,skipped:e.skipped??0,awaiting:e.awaiting_destination??0,sent:e.sent??0,lastSentAt:t[0]?.sent_at?.toISOString()??null,lastFailedAt:t[0]?.failed_at?.toISOString()??null,lastError:t[0]?.last_error??null,recent:n.map(e=>({id:e.id,orderNumber:e.order_number,kind:e.kind,status:e.status,attempts:e.attempts,maxAttempts:e.max_attempts,nextAttemptAt:e.next_attempt_at.toISOString(),errorKind:e.error_kind,lastError:e.last_error,updatedAt:e.updated_at.toISOString()}))}}let M=e=>({fullName:e.full_name,displayName:e.telegram_display_name,username:e.telegram_username,userId:e.telegram_user_id,status:e.telegram_status});async function Z(e){if(0===e.length)return[];let t=(0,k.B)();return(await t`
    select full_name, telegram_display_name, telegram_username, telegram_user_id, telegram_status
    from dtic_members where id in ${t(e)} order by full_name`).map(M)}async function K(e,t){if(!/^\d{1,18}$/.test(t))return null;let[n]=await (0,k.B)()`
    select l.detail, l.created_at, u.full_name as actor_name, o.order_number, o.title, t.name as team_name
    from auth_audit_log l
    join orders o on o.id = ${e}
    left join app_users u on u.id = l.actor_user_id
    left join dtic_teams t on t.id = o.team_id
    where l.id = ${t}::bigint and l.action = 'order_pic_changed' and l.detail->>'orderId' = ${e}`;return n?{orderId:e,orderNumber:n.order_number,title:n.detail.title??n.title,operation:n.detail.operation??null,teamName:n.team_name,before:n.detail.before??[],after:n.detail.after??[],added:await Z(n.detail.addedIds??[]),removed:n.detail.removed??[],reason:n.detail.reason??null,actorName:n.detail.actorName??n.actor_name,changedAt:n.created_at}:null}async function Q(e){return(await (0,k.B)()`
    select m.full_name, m.telegram_display_name, m.telegram_username, m.telegram_user_id, m.telegram_status
    from order_assignments a join dtic_members m on m.id = a.member_id
    where a.order_id = ${e} order by a.assigned_at, m.full_name`).map(e=>({fullName:e.full_name,displayName:e.telegram_display_name,username:e.telegram_username,userId:e.telegram_user_id,status:e.telegram_status}))}async function H(e){let[t]=await (0,k.B)()`
    select o.id, o.order_number, o.status, o.created_at, o.requester_name, b.name as brand_name, tm.name as team_name,
           o.department, o.design_type, o.title, o.brief, p.name as priority_name, o.deadline_at,
           (select count(*)::int from order_attachments a where a.order_id = o.id) as attachment_count
    from orders o
    join brands b on b.id = o.brand_id
    left join dtic_teams tm on tm.id = o.team_id
    left join priority_levels p on p.code = o.priority
    where o.id = ${e}`;return t?{id:t.id,orderNumber:t.order_number,status:t.status,createdAt:t.created_at,requesterName:t.requester_name,department:t.department,brandName:t.brand_name,teamName:t.team_name,designType:t.design_type,title:t.title,brief:t.brief,priorityName:t.priority_name,deadlineAt:t.deadline_at,attachmentCount:t.attachment_count,picInfos:await Q(t.id)}:null}async function W(e,t){let[n]=await (0,k.B)()`
    select o.id as order_id, o.order_number, o.title, h.previous_status, h.new_status, h.changed_at, h.notes, u.full_name as actor_name
    from order_status_history h
    join orders o on o.id = h.order_id
    left join app_users u on u.id = h.changed_by
    where h.id = ${t} and h.order_id = ${e}`;return n?{orderId:n.order_id,orderNumber:n.order_number,title:n.title,previousStatus:n.previous_status,newStatus:n.new_status,changedAt:n.changed_at,note:n.notes,actorName:n.actor_name,picInfos:await Q(n.order_id)}:null}e.s(["P",0,D,"Q",0,x,"R",0,$,"h",0,q,"i",0,N,"j",0,T,"E",0,H,"T",0,K,"S",0,W,"v",0,U,"k",0,P,"g",0,O,"w",0,C,"l",0,I,"B",0,F,"c",0,A,"p",0,R,"O",0,j,"F",0,E,"x",0,B],2838)}];

//# sourceMappingURL=src_lib_dates_ts_1l2u0e5rkf_t9._.js.map