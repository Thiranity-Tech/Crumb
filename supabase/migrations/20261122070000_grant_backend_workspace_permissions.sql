-- The Vercel server endpoint uses the server-only Supabase role to provision
-- workspaces and their first owner. These grants never expose access to users.
grant select, insert, update, delete on table public.businesses to service_role;
grant select, insert, update, delete on table public.business_members to service_role;
grant select, insert, update, delete on table public.products to service_role;
grant select, insert, update, delete on table public.purchases to service_role;
grant select, insert, update, delete on table public.expenses to service_role;
grant select, insert, update, delete on table public.sales to service_role;
grant select, insert, update, delete on table public.sale_items to service_role;
