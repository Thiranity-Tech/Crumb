-- Workspaces are provisioned exclusively through the platform-admin server API.
create or replace function public.get_platform_businesses()
returns table (business_id uuid, business_name text, created_at timestamptz, products bigint, bills bigint, revenue numeric, expenses numeric, purchases numeric)
language sql stable security definer set search_path = public as $$
  select b.id, b.name, b.created_at,
    (select count(*) from public.products p where p.business_id=b.id),
    (select count(*) from public.sales s where s.business_id=b.id),
    coalesce((select sum(s.total) from public.sales s where s.business_id=b.id),0),
    coalesce((select sum(e.amount) from public.expenses e where e.business_id=b.id),0),
    coalesce((select sum(pu.total_cost) from public.purchases pu where pu.business_id=b.id),0)
  from public.businesses b where public.is_platform_administrator() order by b.created_at desc;
$$;
