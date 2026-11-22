-- Required in temporary no-login mode: allow the Supabase anonymous API role
-- to use the tables protected by the shared-workspace RLS policies.
grant usage on schema public to anon;
grant select, insert, update, delete on table public.businesses to anon;
grant select, insert, update, delete on table public.products to anon;
grant select, insert, update, delete on table public.purchases to anon;
grant select, insert, update, delete on table public.expenses to anon;
grant select, insert, update, delete on table public.sales to anon;
grant select, insert, update, delete on table public.sale_items to anon;
grant usage, select on all sequences in schema public to anon;
