module.exports=[78160,a=>{"use strict";var b=a.i(14766);async function c(){let a=Object.fromEntries((await (0,b.f)()`
    select status, count(*)::int as n from notification_outbox where channel = 'telegram' group by status`).map(a=>[a.status,a.n])),c=await (0,b.f)()`
    select max(sent_at) as sent_at,
           max(updated_at) filter (where status = 'failed') as failed_at,
           (select last_error from notification_outbox where channel = 'telegram' and status in ('failed', 'retrying') order by updated_at desc limit 1) as last_error
    from notification_outbox where channel = 'telegram'`,d=await (0,b.f)()`
    select n.id, o.order_number, n.kind, n.status, n.attempts, n.max_attempts, n.next_attempt_at, n.error_kind, n.last_error, n.updated_at
    from notification_outbox n join orders o on o.id = n.order_id
    where n.channel = 'telegram'
    order by n.updated_at desc limit 15`;return{pending:a.pending??0,processing:a.processing??0,retrying:a.retrying??0,failed:a.failed??0,skipped:a.skipped??0,awaiting:a.awaiting_destination??0,sent:a.sent??0,lastSentAt:c[0]?.sent_at?.toISOString()??null,lastFailedAt:c[0]?.failed_at?.toISOString()??null,lastError:c[0]?.last_error??null,recent:d.map(a=>({id:a.id,orderNumber:a.order_number,kind:a.kind,status:a.status,attempts:a.attempts,maxAttempts:a.max_attempts,nextAttemptAt:a.next_attempt_at.toISOString(),errorKind:a.error_kind,lastError:a.last_error,updatedAt:a.updated_at.toISOString()}))}}a.s(["f",0,c])}];

//# sourceMappingURL=src_lib_server_repositories_notifications_ts_1ui9sfojsp1ar._.js.map