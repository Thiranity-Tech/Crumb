create extension if not exists "pgcrypto";

create table public.businesses (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 1), created_at timestamptz not null default now()
);
create table public.products (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0), selling_price numeric(12,2) not null check (selling_price >= 0), created_at timestamptz not null default now()
);
create table public.purchases (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict, quantity numeric(12,3) not null check (quantity > 0),
  unit text not null default 'Piece', total_cost numeric(12,2) not null check (total_cost >= 0), purchased_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.expenses (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  description text not null check (char_length(trim(description)) > 0), amount numeric(12,2) not null check (amount >= 0), expense_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.sales (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  bill_number bigint generated always as identity, customer_name text, customer_phone text, payment_method text not null default 'Cash',
  discount numeric(12,2) not null default 0 check (discount >= 0), subtotal numeric(12,2) not null check (subtotal >= 0), total numeric(12,2) not null check (total >= 0), sold_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.sale_items (
  id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.sales(id) on delete cascade, product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null, unit_price numeric(12,2) not null check (unit_price >= 0), quantity numeric(12,3) not null check (quantity > 0), cost_at_sale numeric(12,2) not null default 0 check (cost_at_sale >= 0)
);
create index on public.products(business_id); create index on public.purchases(business_id, purchased_at); create index on public.expenses(business_id, expense_at); create index on public.sales(business_id, sold_at); create index on public.sale_items(sale_id);

alter table public.businesses enable row level security; alter table public.products enable row level security; alter table public.purchases enable row level security; alter table public.expenses enable row level security; alter table public.sales enable row level security; alter table public.sale_items enable row level security;
create policy "owners manage business" on public.businesses for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage products" on public.products for all using (business_id in (select id from public.businesses where owner_id = auth.uid())) with check (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy "owners manage purchases" on public.purchases for all using (business_id in (select id from public.businesses where owner_id = auth.uid())) with check (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy "owners manage expenses" on public.expenses for all using (business_id in (select id from public.businesses where owner_id = auth.uid())) with check (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy "owners manage sales" on public.sales for all using (business_id in (select id from public.businesses where owner_id = auth.uid())) with check (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy "owners manage sale items" on public.sale_items for all using (sale_id in (select id from public.sales where business_id in (select id from public.businesses where owner_id = auth.uid()))) with check (sale_id in (select id from public.sales where business_id in (select id from public.businesses where owner_id = auth.uid())));
