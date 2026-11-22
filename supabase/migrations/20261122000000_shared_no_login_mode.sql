-- Temporary shared-workspace mode: permits anonymous browser access.
-- Restore authenticated policies before using this app with multiple businesses.
alter table public.businesses alter column owner_id drop not null;
drop policy if exists "owners manage business" on public.businesses;
drop policy if exists "owners manage products" on public.products;
drop policy if exists "owners manage purchases" on public.purchases;
drop policy if exists "owners manage expenses" on public.expenses;
drop policy if exists "owners manage sales" on public.sales;
drop policy if exists "owners manage sale items" on public.sale_items;

create policy "shared workspace business" on public.businesses for all using (true) with check (true);
create policy "shared workspace products" on public.products for all using (true) with check (true);
create policy "shared workspace purchases" on public.purchases for all using (true) with check (true);
create policy "shared workspace expenses" on public.expenses for all using (true) with check (true);
create policy "shared workspace sales" on public.sales for all using (true) with check (true);
create policy "shared workspace sale items" on public.sale_items for all using (true) with check (true);
