-- Purchases are finance-only records and do not need a menu product relation.
alter table public.purchases add column if not exists product_name text;
alter table public.purchases alter column product_id drop not null;
update public.purchases p set product_name = pr.name from public.products pr where p.product_id = pr.id and p.product_name is null;
