module.exports=[2041,a=>{"use strict";var b=a.i(14766),c=a.i(84896),d=a.i(86326),e=a.i(90428);let f=c.S;async function g(a,e=new Date){let h=(0,b.f)(),i=h`
    where true
    ${(0,d.x)(h,a.scope)}
    ${a.from?h`and o.created_at >= ${a.from}`:h``}
    ${a.to?h`and o.created_at < ${a.to}`:h``}
    ${a.brandId?h`and o.brand_id = ${a.brandId}`:h``}`,[j,[k],l,m,n]=await Promise.all([h`
      select o.status, count(*)::int as count from orders o ${i} group by o.status`,h`
      select count(*)::int as count from orders o ${i}
      and o.deadline_at < ${e} and o.status not in ${h(f)}`,h`
      select b.id as brand_id, b.name as brand_name, b.is_active,
             count(o.id)::int as total,
             count(o.id) filter (where o.status not in ${h(f)})::int as active,
             count(o.id) filter (where o.status not in ${h(f)} and o.deadline_at < ${e})::int as overdue
      from brands b
      left join orders o on o.brand_id = b.id ${a.scope?h`and o.id in (select sa.order_id from order_assignments sa where ${a.scope.memberId?h`sa.member_id = ${a.scope.memberId}`:h`false`})`:h``}
        ${a.from?h`and o.created_at >= ${a.from}`:h``}
        ${a.to?h`and o.created_at < ${a.to}`:h``}
      ${a.brandId?h`where b.id = ${a.brandId}`:h``}
      group by b.id
      order by b.sort_order, b.name`,h`
      select ${(0,d.s)(h)} from ${(0,d.z)(h)} ${i}
      order by o.created_at desc limit 6`,h`
      select ${(0,d.s)(h)} from ${(0,d.z)(h)} ${i}
      and o.status not in ${h(f)}
      order by o.deadline_at asc limit 6`]),o=Object.fromEntries(c.v.map(a=>[a,0]));for(let a of j)a.status in o&&(o[a.status]=a.count);return{stats:{total:Object.values(o).reduce((a,b)=>a+b,0),overdue:k.count,byStatus:o},brands:l.map(a=>({brandId:a.brand_id,brandName:a.brand_name,isActive:a.is_active,total:a.total,active:a.active,overdue:a.overdue})),recent:m.map(d.S),upcoming:n.map(d.S)}}async function h(a){let c=(0,b.f)(),f=c`coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id))`,g=c`${(0,d.x)(c,a.scope)} ${a.brandId?c`and o.brand_id = ${a.brandId}`:c``}`,[h,i,j]=await Promise.all([c`
      select to_char(o.created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD') as day, count(*)::int as count
      from orders o where true ${g}
      and o.created_at >= ${a.trendFrom} and o.created_at < ${a.trendTo}
      group by 1`,c`
      select to_char(o.completed_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD') as day, count(*)::int as count
      from orders o where o.status = 'completed' and o.completed_at is not null ${g}
      and o.completed_at >= ${a.trendFrom} and o.completed_at < ${a.trendTo}
      group by 1`,c`
      select ${f} as team_id, (select t.name from dtic_teams t where t.id = ${f}) as name, count(*)::int as count
      from orders o where true ${g}
      ${a.rangeFrom?c`and o.created_at >= ${a.rangeFrom}`:c``}
      ${a.rangeTo?c`and o.created_at < ${a.rangeTo}`:c``}
      group by 1, 2 order by count desc, name nulls last`]),k=new Map(h.map(a=>[a.day,a.count])),l=new Map(i.map(a=>[a.day,a.count])),m=[];for(let b of(0,e.i)(a.trendFrom,a.trendTo))m.push({day:b,intake:k.get(b)??0,completed:l.get(b)??0});return{trend:m,byTeam:j.map(a=>({teamId:a.team_id,name:a.name??"Tanpa tim",count:a.count}))}}a.s(["J",0,h,"Z",0,g])}];

//# sourceMappingURL=src_lib_server_repositories_dashboard_ts_1nfa9dxpb1zdf._.js.map