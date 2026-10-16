module.exports=[13348,a=>{"use strict";var b=a.i(14766);class c extends Error{status;fieldErrors;constructor(a,b=400,c){super(a),this.status=b,this.fieldErrors=c,this.name="AppError"}}var d=a.i(25251);async function e(a={}){let c=(0,b.f)();return(await c`
    select id, name, requires_detail, is_active, team_id from design_order_types
    ${a.activeOnly?c`where is_active`:c``}
    order by sort_order, name`).map(a=>({id:a.id,name:a.name,requiresDetail:a.requires_detail,isActive:a.is_active,teamId:a.team_id}))}async function f(){let a=await (0,b.f)()`
    select id, slug, name, description from dtic_teams where is_active order by sort_order, name`,c=await (0,b.f)()`
    select tm.team_id, m.id, m.full_name
    from dtic_team_members tm join dtic_members m on m.id = tm.member_id
    where m.is_active order by m.sort_order, m.full_name`;return a.map(a=>({id:a.id,slug:a.slug,name:a.name,description:a.description,members:c.filter(b=>b.team_id===a.id).map(a=>({id:a.id,name:a.full_name}))}))}async function g(a={}){let c=(0,b.f)();return(await c`
    select code, name, tone, is_active from priority_levels
    ${a.activeOnly?c`where is_active`:c``}
    order by sort_order, name`).map(a=>({code:a.code,name:a.name,tone:a.tone,isActive:a.is_active}))}async function h(){return(await (0,b.f)()`
    select id, name, is_active from dtic_departments order by sort_order, name`).map(a=>({id:a.id,name:a.name,isActive:a.is_active}))}async function i(){return(await (0,b.f)()`select id, name, is_active from dtic_teams order by sort_order, name`).map(a=>({id:a.id,name:a.name,isActive:a.is_active}))}async function j(){let a=await (0,b.f)()`
    select tm.team_id, m.id, m.full_name, m.position, d.name as department_name, m.is_active
    from dtic_team_members tm
    join dtic_members m on m.id = tm.member_id
    join dtic_departments d on d.id = m.department_id
    where m.is_active
    order by m.full_name`,c={};for(let b of a)(c[b.team_id]??=[]).push({id:b.id,name:b.full_name,division:`${b.position} of ${b.department_name}`,departmentName:b.department_name,isActive:b.is_active});return c}async function k(a){return a?(await (0,b.f)()`
    select m.id, m.full_name, m.position, d.name as department_name, m.is_active
    from dtic_team_members tm
    join dtic_members m on m.id = tm.member_id
    join dtic_departments d on d.id = m.department_id
    where tm.team_id = ${a} and m.is_active
    order by m.full_name`).map(a=>({id:a.id,name:a.full_name,division:`${a.position} of ${a.department_name}`,departmentName:a.department_name,isActive:a.is_active})):[]}async function l(){return(await (0,b.f)()`
    select m.id, m.full_name, m.position, d.name as department_name, m.is_active, d.is_active as dept_active
    from dtic_members m join dtic_departments d on d.id = m.department_id
    order by d.sort_order, d.name, m.sort_order, m.full_name`).map(a=>({id:a.id,name:a.full_name,division:`${a.position} of ${a.department_name}`,departmentName:a.department_name,isActive:a.is_active}))}async function m(){let a=await (0,b.f)()`
    select code from priority_levels where is_active
    order by (code = ${d.r}) desc, sort_order, name limit 1`;if(!a[0])throw new c("Belum ada level prioritas aktif. Hubungi tim DTIC.",503);return a[0].code}async function n(a){let c=(0,b.f)();switch(a){case"brands":return(await c`
        select b.id, b.name, b.slug, b.sort_order, b.is_active, (select count(*)::int from orders o where o.brand_id = b.id) as usage
        from brands b order by b.sort_order, b.name`).map(a=>({id:a.id,values:{name:a.name,slug:a.slug,sortOrder:a.sort_order,isActive:a.is_active},usage:a.usage,subtitle:`${a.slug} \xb7 ${a.usage} order`}));case"departments":return(await c`
        select d.id, d.name, d.slug, d.sort_order, d.is_active, (select count(*)::int from dtic_members m where m.department_id = d.id) as usage
        from dtic_departments d order by d.sort_order, d.name`).map(a=>({id:a.id,values:{name:a.name,slug:a.slug,sortOrder:a.sort_order,isActive:a.is_active},usage:a.usage,subtitle:`${a.slug} \xb7 ${a.usage} member`}));case"members":return(await c`
        select m.id, m.full_name, m.department_id, d.name as department_name, m.position, m.email, m.sort_order, m.is_active,
               m.telegram_display_name, m.telegram_username, m.telegram_user_id, m.telegram_status,
               (select u.role from app_users u where u.member_id = m.id) as account_role
        from dtic_members m join dtic_departments d on d.id = m.department_id
        order by d.sort_order, m.sort_order, m.full_name`).map(a=>({id:a.id,values:{fullName:a.full_name,departmentId:a.department_id,position:a.position,email:a.email,sortOrder:a.sort_order,isActive:a.is_active,telegramDisplayName:a.telegram_display_name,telegramUsername:a.telegram_username,telegramUserId:a.telegram_user_id,telegramStatus:a.telegram_status,accountRole:a.account_role},usage:0,subtitle:`${a.position} of ${a.department_name}${a.email?` \xb7 ${a.email}`:""}`}));case"order-types":return(await c`
        select t.id, t.name, t.team_id, tm.name as team_name, t.requires_detail, t.sort_order, t.is_active,
               (select count(*)::int from orders o where o.design_order_type_id = t.id) as usage
        from design_order_types t left join dtic_teams tm on tm.id = t.team_id order by t.sort_order, t.name`).map(a=>({id:a.id,values:{name:a.name,teamId:a.team_id??"",requiresDetail:a.requires_detail,sortOrder:a.sort_order,isActive:a.is_active},usage:a.usage,subtitle:`${a.team_name?`Tim ${a.team_name} \xb7 `:"Belum ada tim (tidak tampil di form) · "}${a.requires_detail?"Client menulis jenisnya sendiri · ":""}${a.usage} order`}));case"priorities":return(await c`
        select p.code, p.name, p.tone, p.sort_order, p.is_active, (select count(*)::int from orders o where o.priority = p.code) as usage
        from priority_levels p order by p.sort_order, p.name`).map(a=>({id:a.code,values:{code:a.code,name:a.name,tone:a.tone,sortOrder:a.sort_order,isActive:a.is_active},usage:a.usage,subtitle:`kode: ${a.code}${a.code===d.r?" · default":""} \xb7 ${a.usage} order`}))}}a.s(["_",0,h,"u",0,n,"K",0,l,"S",0,e,"T",0,g,"z",0,i,"$",0,k,"c",0,j,"p",0,f,"U",0,m],13348)}];

//# sourceMappingURL=src_lib_server_repositories_master-data_ts_0a8uobcy0vwc_._.js.map