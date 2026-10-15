module.exports=[33737,a=>{"use strict";var b=a.i(14766);async function c(a=null){let d="string"==typeof a||null===a?{teamId:a}:a,e=d.teamId??null,f=(0,b.f)(),g=f`${d.statuses?.length?f`and o.status in ${f(d.statuses)}`:f``}
    ${d.from?f`and o.created_at >= ${d.from}`:f``}
    ${d.to?f`and o.created_at < ${d.to}`:f``}`,h=e?f`m.is_active and exists (select 1 from dtic_team_members tm where tm.member_id = m.id and tm.team_id = ${e})`:f`(m.is_active and exists (select 1 from dtic_team_members tm where tm.member_id = m.id))
         or exists (select 1 from order_assignments a join orders o on o.id = a.order_id
                    where a.member_id = m.id and o.status not in ('completed', 'cancelled'))`;return(await f`
    select m.id, m.full_name, m.position, d.name as department_name, m.is_active,
           coalesce((select array_agg(t.name order by t.sort_order, t.name)
                     from dtic_team_members tm join dtic_teams t on t.id = tm.team_id
                     where tm.member_id = m.id), '{}') as teams,
           s.active, s.in_progress, s.pending, s.on_hold, s.overdue, s.nearest
    from dtic_members m
    join dtic_departments d on d.id = m.department_id
    cross join lateral (
      select count(*) filter (where o.status in ('submitted', 'assigned', 'in_progress', 'pending_confirmation'))::int as active,
             count(*) filter (where o.status = 'in_progress')::int as in_progress,
             count(*) filter (where o.status = 'pending_confirmation')::int as pending,
             count(*) filter (where o.status = 'on_hold')::int as on_hold,
             count(*) filter (where o.status not in ('completed', 'cancelled') and o.deadline_at < now())::int as overdue,
             min(o.deadline_at) filter (where o.status not in ('completed', 'cancelled')) as nearest
      from order_assignments a join orders o on o.id = a.order_id
      where a.member_id = m.id ${g}
    ) s
    where (${h})
    order by s.active desc, s.overdue desc, m.full_name`).map(a=>({memberId:a.id,name:a.full_name,division:`${a.position} of ${a.department_name}`,teams:a.teams,isActive:a.is_active,active:a.active,inProgress:a.in_progress,pendingConfirmation:a.pending,onHold:a.on_hold,overdue:a.overdue,nearestDeadline:a.nearest?.toISOString()??null}))}async function d(a){if(0===a.length)return[];let c=(0,b.f)();return(await c`
    select a.member_id, o.id, o.order_number, o.title, o.status, o.deadline_at
    from order_assignments a join orders o on o.id = a.order_id
    where a.member_id in ${c(a)} and o.status not in ('completed', 'cancelled')
    order by o.deadline_at, o.order_number`).map(a=>({memberId:a.member_id,id:a.id,orderNumber:a.order_number,title:a.title,status:a.status,deadlineAt:a.deadline_at.toISOString()}))}async function e(a){let c=(0,b.f)(),d=c`coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id))`,[e]=await c`
    select count(*) filter (where x.n = 1)::int as single,
           count(*) filter (where x.n > 1)::int as multi,
           count(*) filter (where x.n = 0)::int as unassigned,
           count(*)::int as total
    from (
      select o.id, (select count(*) from order_assignments a where a.order_id = o.id) as n
      from orders o
      where o.status not in ('completed', 'cancelled')
      ${a.teamId?c`and ${d} = ${a.teamId}`:c``}
      ${a.from?c`and o.created_at >= ${a.from}`:c``}
      ${a.to?c`and o.created_at < ${a.to}`:c``}
    ) x`;return e}a.s(["F",0,e,"l",0,c,"G",0,d])}];

//# sourceMappingURL=src_lib_server_repositories_workload_ts_1ffb_mf1xyr2a._.js.map