(()=>{"use strict";module.exports=[56386,a=>{a.i(14766),a.s(["f",0,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i])},75027,a=>{var b=a.i(14766);async function c(a){return(await (0,b.f)()`
    select l.id::text as id, l.action, a.full_name as actor_name, t.email as target_email, l.detail, l.created_at
    from auth_audit_log l
    left join app_users a on a.id = l.actor_user_id
    left join app_users t on t.id = l.target_user_id
    order by l.created_at desc, l.id desc
    limit ${a}`).map(a=>{var b;let c;return{id:a.id,action:a.action,actorName:a.actor_name,targetEmail:a.target_email,detail:(b=a.detail,c=/password|token|hash|secret/i,Object.fromEntries(Object.entries(b??{}).filter(([a])=>!c.test(a)))),createdAt:a.created_at.toISOString()}})}a.s(["f",0,c])},23064,a=>{a.s(["f",0,function(a){return a.startsWith("@")?`${a.slice(0,2)}••••`:`••••${a.slice(-4)}`}])}]})();

//# sourceMappingURL=src_lib_0pb2mhawhqa3d._.js.map