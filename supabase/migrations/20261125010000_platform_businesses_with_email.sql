-- Return owner client email in get_platform_businesses function
drop function if exists public.get_platform_businesses();

create or replace function public.get_platform_businesses()
returns table (
  business_id uuid,
  business_name text,
  created_at timestamptz,
  access_ends_at timestamptz,
  owner_id uuid,
  owner_email text,
  products bigint,
  bills bigint,
  revenue numeric,
  expenses numeric,
  purchases numeric
)
language sql stable security definer set search_path = public as $$
  select b.id, b.name, b.created_at, b.access_ends_at, b.owner_id,
    coalesce((select u.email from auth.users u where u.id = b.owner_id), (select u.email from public.business_members bm join auth.users u on u.id = bm.user_id where bm.business_id = b.id and bm.role = 'owner' limit 1), '—'),
    (select count(*) from public.products p where p.business_id=b.id),
    (select count(*) from public.sales s where s.business_id=b.id),
    coalesce((select sum(s.total) from public.sales s where s.business_id=b.id),0),
    coalesce((select sum(e.amount) from public.expenses e where e.business_id=b.id),0),
    coalesce((select sum(pu.total_cost) from public.purchases pu where pu.business_id=b.id),0)
  from public.businesses b where public.is_platform_administrator() order by b.created_at desc;
$$;

revoke all on function public.get_platform_businesses() from public;
grant execute on function public.get_platform_businesses() to authenticated;
