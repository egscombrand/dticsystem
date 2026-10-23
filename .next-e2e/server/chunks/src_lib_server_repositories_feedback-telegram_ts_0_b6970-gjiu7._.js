module.exports=[2585,t=>{"use strict";var e=t.i(29286),a=t.i(25502);async function i(){let[t]=await (0,e.B)()`
    select id, chat_id, message_thread_id, is_active, verification_status from feedback_telegram_channel limit 1`;return t?{configId:t.id,chatId:t.chat_id,threadId:t.message_thread_id,isActive:t.is_active,verificationStatus:t.verification_status}:null}async function n(t,i,n){try{return await (0,e.B)().begin(async e=>{let[a]=await e`
        select id, chat_id, verification_status, chat_title from feedback_telegram_channel limit 1 for update`;if(a){let s=a.chat_id!==t.chatId;return s&&"verified"===a.verification_status&&!n?{kind:"replace_required",currentTitle:a.chat_title}:(await e`
          update feedback_telegram_channel set
            chat_id = ${t.chatId}, chat_title = ${t.chatTitle}, chat_username = ${t.chatUsername}, source_link = ${t.sourceLink},
            message_thread_id = ${t.threadId}, verification_status = 'verified', verified_at = now(),
            is_active = case when ${s} then false else is_active end,
            last_test_result = case when ${s} then null else last_test_result end,
            last_test_message = case when ${s} then null else last_test_message end,
            last_tested_at = case when ${s} then null else last_tested_at end,
            updated_by = ${i}
          where id = ${a.id}`,{kind:"saved",created:!1})}return await e`
        insert into feedback_telegram_channel (chat_id, chat_title, chat_username, source_link, message_thread_id, verification_status, verified_at, is_active, created_by, updated_by)
        values (${t.chatId}, ${t.chatTitle}, ${t.chatUsername}, ${t.sourceLink}, ${t.threadId}, 'verified', now(), false, ${i}, ${i})`,{kind:"saved",created:!0}})}catch(t){if("23505"===(0,a.g)(t))throw new a.A("Grup ini sudah terhubung ke tujuan lain. Satu grup Telegram hanya untuk satu tujuan.",409,{link:"Grup sudah dipakai tujuan lain."});throw t}}async function s(){let[t]=await (0,e.B)()`delete from feedback_telegram_channel returning chat_title`;if(!t)throw new a.i("Grup Tim IT belum terhubung.");return{chatTitle:t.chat_title}}async function r(t,i){let n=await (0,e.B)()`
    update feedback_telegram_channel set is_active = case when ${t} and verification_status = 'verified' then true else false end, updated_by = ${i}
    returning verification_status`;if(0===n.length)throw new a.i("Grup Tim IT belum diverifikasi.");if(t&&"verified"!==n[0].verification_status)throw new a.A("Verifikasi grup terlebih dahulu sebelum mengaktifkan integrasi.",409,{isActive:"Belum terverifikasi."})}async function c(t=20){return(await (0,e.B)()`
    update feedback_telegram_channel set test_locked_until = now() + make_interval(secs => ${t})
    where test_locked_until is null or test_locked_until < now()
    returning id`).length>0}async function d(){await (0,e.B)()`update feedback_telegram_channel set test_locked_until = null`}async function l(t){await (0,e.B)()`update feedback_telegram_channel set last_tested_at = now(), last_test_result = ${t.ok?"ok":"failed"}, last_test_message = ${t.message.slice(0,300)}`}async function u(t,e){await t`insert into feedback_notifications (ticket_id) values (${e})`}async function _(t){return(await (0,e.B)()`
    update feedback_notifications set status = 'processing', locked_at = now()
    where id in (
      select id from feedback_notifications
      where attempts < ${8}
        and (status = 'pending' or (status = 'failed' and attempts < ${8}) or (status = 'processing' and locked_at < now() - make_interval(secs => ${120})))
      order by created_at
      limit ${t}
      for update skip locked
    )
    returning id, ticket_id, attempts`).map(t=>({id:t.id,ticketId:t.ticket_id,attempts:t.attempts}))}async function o(t){await (0,e.B)()`update feedback_notifications set status = 'sent', sent_at = now(), locked_at = null, last_error = null where id = ${t}`}async function f(t,a,i){await (0,e.B)()`update feedback_notifications set status = 'failed', attempts = ${a+1}, last_error = ${i.slice(0,300)}, locked_at = null where id = ${t}`}async function h(t){let[a]=await (0,e.B)()`
    select status, attempts, last_error, sent_at from feedback_notifications where ticket_id = ${t}`;return a?{status:a.status,attempts:a.attempts,lastError:a.last_error,sentAt:a.sent_at?.toISOString()??null}:null}async function m(t){let[a]=await (0,e.B)()`select id, attempts from feedback_notifications where ticket_id = ${t}`;if(a)return a;let[i]=await (0,e.B)()`
    insert into feedback_notifications (ticket_id) values (${t})
    on conflict (ticket_id) do update set ticket_id = excluded.ticket_id
    returning id, attempts`;return i}async function k(t,a){await (0,e.B)()`
    insert into feedback_notification_attempts (ticket_id, kind, status, actor_user_id, actor_name, error)
    values (${t}, ${a.kind}, ${a.status}, ${a.actorUserId??null}, ${a.actorName??null}, ${a.error?.slice(0,300)??null})`}async function w(t,a=20){return(await (0,e.B)()`
    select id, kind, status, actor_name, error, attempted_at from feedback_notification_attempts
    where ticket_id = ${t} order by attempted_at desc limit ${a}`).map(t=>({id:t.id,kind:t.kind,status:t.status,actorName:t.actor_name,error:t.error,attemptedAt:t.attempted_at.toISOString()}))}t.s(["X",0,c,"C",0,i,"H",0,_,"L",0,s,"z",0,u,"N",0,m,"m",0,h,"v",0,w,"P",0,f,"S",0,o,"r",0,k,"I",0,l,"J",0,d,"Y",0,n,"s",0,r])}];

//# sourceMappingURL=src_lib_server_repositories_feedback-telegram_ts_0_b6970-gjiu7._.js.map