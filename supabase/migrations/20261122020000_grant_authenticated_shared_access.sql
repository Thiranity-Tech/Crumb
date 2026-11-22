-- Existing browser sessions use the authenticated API role even though the
-- interface no longer displays login. Keep it aligned with anonymous access
-- for this temporary shared-workspace deployment.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.businesses to authenticated;
grant select, insert, update, delete on table public.products to authenticated;
grant select, insert, update, delete on table public.purchases to authenticated;
grant select, insert, update, delete on table public.expenses to authenticated;
grant select, insert, update, delete on table public.sales to authenticated;
grant select, insert, update, delete on table public.sale_items to authenticated;
grant usage, select on all sequences in schema public to authenticated;
