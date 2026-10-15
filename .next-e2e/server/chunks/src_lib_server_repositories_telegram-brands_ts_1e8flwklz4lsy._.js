module.exports=[41142,e=>{"use strict";var t=e.i(29286),a=e.i(25502),n=e.i(24610),i=e.i(37333);let r="default",s="Grup Telegram Global";function d(e){return{configId:e.id,chatMasked:(0,i.T)(e.chat_id),chatTitle:e.chat_title,chatUsername:e.chat_username,sourceLink:e.source_link,topicId:e.message_thread_id,isActive:e.is_active,verificationStatus:e.verification_status,verifiedAt:e.verified_at?.toISOString()??null,events:{new_order:e.notify_new_order,status_changed:e.notify_status_changed,waiting_confirmation:e.notify_waiting_confirmation,completed:e.notify_completed,on_hold:e.notify_on_hold,cancelled:e.notify_cancelled,pic_changed:e.notify_pic_changed},lastTestedAt:e.last_tested_at?.toISOString()??null,lastTestResult:e.last_test_result,lastTestMessage:e.last_test_message,updatedAt:e.updated_at.toISOString()}}async function l(){let e=await (0,t.B)()`
    select b.id, b.name, b.is_active,
           (select max(n.sent_at) from notification_outbox n where n.brand_id = b.id and n.status = 'sent') as last_sent_at,
           (select count(*)::int from notification_outbox n where n.brand_id = b.id and n.status = 'failed') as failed_count
    from brands b order by b.sort_order, b.name`,a=await (0,t.B)()`select * from telegram_brand_channels`,n=new Map(a.map(e=>[e.brand_id,e])),i=a.find(e=>null===e.brand_id),[l]=i?await (0,t.B)()`
        select max(sent_at) filter (where status = 'sent') as last_sent_at, (count(*) filter (where status = 'failed'))::int as failed_count
        from notification_outbox where config_id = ${i.id}`:[];return[{brandId:r,brandName:s,brandActive:!0,channel:i?d(i):null,lastSentAt:l?.last_sent_at?.toISOString()??null,failedCount:l?.failed_count??0},...e.map(e=>{let t=n.get(e.id);return{brandId:e.id,brandName:e.name,brandActive:e.is_active,channel:t?d(t):null,lastSentAt:e.last_sent_at?.toISOString()??null,failedCount:e.failed_count}})]}async function _(e,n,i,r){try{return await (0,t.B)().begin(async t=>{if(e){let[n]=await t`select id from brands where id = ${e}`;if(!n)throw new a.i("Brand tidak ditemukan.")}let[s]=await t`
        select id, chat_id, verification_status, chat_title from telegram_brand_channels where brand_id is not distinct from ${e} for update`;if(s){let e=s.chat_id!==n.chatId;return e&&"verified"===s.verification_status&&!r?{kind:"replace_required",currentTitle:s.chat_title}:(await t`
          update telegram_brand_channels set
            chat_id = ${n.chatId}, chat_title = ${n.chatTitle}, chat_username = ${n.chatUsername}, source_link = ${n.sourceLink},
            message_thread_id = ${n.threadId},
            verification_status = 'verified', verified_at = now(),
            is_active = case when ${e} then false else is_active end,
            last_test_result = case when ${e} then null else last_test_result end,
            last_test_message = case when ${e} then null else last_test_message end,
            last_tested_at = case when ${e} then null else last_tested_at end,
            updated_by = ${i}
          where id = ${s.id}`,{kind:"saved",created:!1})}return await t`
        insert into telegram_brand_channels (brand_id, chat_id, chat_title, chat_username, source_link, message_thread_id, verification_status, verified_at,
          is_active, created_by, updated_by)
        values (${e}, ${n.chatId}, ${n.chatTitle}, ${n.chatUsername}, ${n.sourceLink}, ${n.threadId}, 'verified', now(), false, ${i}, ${i})`,{kind:"saved",created:!0}})}catch(e){if("23505"===(0,a.g)(e)&&"telegram_brand_channels_chat_key"===(0,a.a)(e))throw new a.A("Grup ini sudah terhubung ke brand lain atau ke Grup Default. Satu grup Telegram hanya untuk satu tujuan.",409,{link:"Grup sudah dipakai tujuan lain."});throw e}}async function c(e){return(0,t.B)().begin(async t=>{let[n]=await t`
      select id, chat_title from telegram_brand_channels where brand_id is not distinct from ${e} for update`;if(!n)throw new a.i("Grup Telegram untuk tujuan ini belum terhubung.");let i=await t`
      update notification_outbox set status = 'awaiting_destination', config_id = null, chat_id = null,
        last_error = ${o}, locked_at = null
      where config_id = ${n.id} and kind = 'order_created' and status in ('pending', 'processing', 'retrying')
      returning id`;return await t`
      update notification_outbox set status = 'skipped', last_error = ${"Grup Telegram diputuskan sebelum pesan terkirim."}, locked_at = null
      where config_id = ${n.id} and status in ('pending', 'processing', 'retrying')`,await t`delete from telegram_brand_channels where id = ${n.id}`,{chatTitle:n.chat_title,requeued:i.length}})}let o="Grup Telegram diputuskan; notifikasi menunggu tujuan baru (grup brand atau Grup Default).";async function u(e,n,i){let r=n.events,s=await (0,t.B)()`
    update telegram_brand_channels set
      is_active = case when ${n.isActive} and verification_status = 'verified' then true else false end,
      notify_new_order = ${r.new_order}, notify_status_changed = ${r.status_changed},
      notify_waiting_confirmation = ${r.waiting_confirmation}, notify_completed = ${r.completed},
      notify_on_hold = ${r.on_hold}, notify_cancelled = ${r.cancelled}, notify_pic_changed = ${r.pic_changed}, updated_by = ${i}
    where brand_id is not distinct from ${e}
    returning verification_status`;if(0===s.length)throw new a.i("Grup Telegram untuk brand ini belum diverifikasi.");if(n.isActive&&"verified"!==s[0].verification_status)throw new a.A("Verifikasi grup terlebih dahulu sebelum mengaktifkan integrasi.",409,{isActive:"Belum terverifikasi."})}async function f(){let[e]=await (0,t.B)()`
    select is_active, verification_status from telegram_brand_channels where brand_id is null`;return e?e.is_active&&"verified"===e.verification_status?"active":"inactive":"none"}async function h(e){let[a]=await (0,t.B)()`
    select c.id, coalesce(b.name, ${s}) as name, c.chat_id, c.message_thread_id, c.is_active, c.verification_status, c.notify_new_order
    from telegram_brand_channels c left join brands b on b.id = c.brand_id where c.brand_id is not distinct from ${e}`;return a?{configId:a.id,brandName:a.name,chatId:a.chat_id,threadId:a.message_thread_id,isActive:a.is_active,verificationStatus:a.verification_status,notifyNewOrder:a.notify_new_order}:null}async function m(e){if(null===e)return s;let[a]=await (0,t.B)()`select name from brands where id = ${e}`;return a?.name??null}async function g(e,a=20){return(await (0,t.B)()`
    update telegram_brand_channels set test_locked_until = now() + make_interval(secs => ${a})
    where brand_id is not distinct from ${e} and (test_locked_until is null or test_locked_until < now())
    returning id`).length>0}async function b(e){await (0,t.B)()`update telegram_brand_channels set test_locked_until = null where brand_id is not distinct from ${e}`}async function w(e,a){await (0,t.B)()`
    update telegram_brand_channels set
      last_tested_at = now(),
      last_test_result = ${a.ok?"ok":"failed"},
      last_test_message = ${a.message.slice(0,300)},
      verification_status = case when ${a.botNoAccess} then 'bot_no_access' else verification_status end,
      is_active = case when ${a.botNoAccess} then false else is_active end
    where brand_id is not distinct from ${e}`}async function p(e,a=50){return(await (0,t.B)()`
    select n.id, o.order_number, n.kind, n.event_type, n.status, n.attempts, n.max_attempts, n.error_kind, n.error_code,
           n.last_error, n.chat_id, n.sent_at, n.updated_at
    from notification_outbox n join orders o on o.id = n.order_id
    where ${null===e?(0,t.B)()`n.config_id = (select id from telegram_brand_channels where brand_id is null)`:(0,t.B)()`n.brand_id = ${e}`}
    order by n.created_at desc limit ${a}`).map(e=>({id:e.id,orderNumber:e.order_number,kind:e.kind,eventType:e.event_type,eventLabel:e.event_type&&i.s.includes(e.event_type)?i.i[e.event_type]:"Pengajuan baru",status:e.status,attempts:e.attempts,maxAttempts:e.max_attempts,errorKind:e.error_kind,errorCode:e.error_code,lastError:e.last_error,chatMasked:e.chat_id?(0,i.T)(e.chat_id):null,sentAt:e.sent_at?.toISOString()??null,updatedAt:e.updated_at.toISOString()}))}e.s(["U",0,g,"_",0,p,"n",0,m,"a",0,h,"b",0,c,"I",0,f,"O",0,l,"f",0,function(e){if(e===r)return null;throw(0,n.K)(e,"Brand"),new a.i("Konfigurasi Telegram per brand tidak lagi dipakai. Kelola grup global di Integrasi Telegram.")},"g",0,w,"A",0,b,"l",0,_,"H",0,u])}];

//# sourceMappingURL=src_lib_server_repositories_telegram-brands_ts_1e8flwklz4lsy._.js.map