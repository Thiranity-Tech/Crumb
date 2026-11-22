-- Replace the temporary shared public workspace with authenticated restaurant users.
create table if not exists public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','admin','staff')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
alter table public.business_members enable row level security;
revoke all on public.business_members from anon;
grant select on public.business_members to authenticated;

create or replace function public.has_business_access(target_business_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.business_members where business_id=target_business_id and user_id=auth.uid());
$$;

-- Give the existing platform administrator ownership of any existing workspace.
insert into public.business_members (business_id,user_id,role)
select b.id,pa.user_id,'owner' from public.businesses b cross join public.platform_administrators pa
on conflict (business_id,user_id) do nothing;

drop policy if exists "shared workspace business" on public.businesses;
drop policy if exists "shared workspace products" on public.products;
drop policy if exists "shared workspace purchases" on public.purchases;
drop policy if exists "shared workspace expenses" on public.expenses;
drop policy if exists "shared workspace sales" on public.sales;
drop policy if exists "shared workspace sale items" on public.sale_items;

create policy "members read businesses" on public.businesses for select to authenticated using (public.has_business_access(id));
create policy "members read products" on public.products for select to authenticated using (public.has_business_access(business_id));
create policy "members write products" on public.products for all to authenticated using (public.has_business_access(business_id)) with check (public.has_business_access(business_id));
create policy "members read purchases" on public.purchases for select to authenticated using (public.has_business_access(business_id));
create policy "members write purchases" on public.purchases for all to authenticated using (public.has_business_access(business_id)) with check (public.has_business_access(business_id));
create policy "members read expenses" on public.expenses for select to authenticated using (public.has_business_access(business_id));
create policy "members write expenses" on public.expenses for all to authenticated using (public.has_business_access(business_id)) with check (public.has_business_access(business_id));
create policy "members read sales" on public.sales for select to authenticated using (public.has_business_access(business_id));
create policy "members write sales" on public.sales for all to authenticated using (public.has_business_access(business_id)) with check (public.has_business_access(business_id));
create policy "members read sale items" on public.sale_items for select to authenticated using (sale_id in (select id from public.sales where public.has_business_access(business_id)));
create policy "members write sale items" on public.sale_items for all to authenticated using (sale_id in (select id from public.sales where public.has_business_access(business_id))) with check (sale_id in (select id from public.sales where public.has_business_access(business_id)));
create policy "members read own membership" on public.business_members for select to authenticated using (user_id=auth.uid());

revoke all on table public.businesses,public.products,public.purchases,public.expenses,public.sales,public.sale_items from anon;
grant select,insert,update,delete on table public.businesses,public.products,public.purchases,public.expenses,public.sales,public.sale_items to authenticated;
grant execute on function public.has_business_access(uuid) to authenticated;
