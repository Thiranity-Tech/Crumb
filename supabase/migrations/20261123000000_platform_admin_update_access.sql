-- Allow platform administrators to directly update workspace access durations.
create or replace function public.update_workspace_access(
  target_business_id uuid,
  new_access_ends_at timestamptz
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_administrator() then
    raise exception 'Platform administrator access required';
  end if;

  update public.businesses
  set access_ends_at = new_access_ends_at
  where id = target_business_id;
end;
$$;

revoke all on function public.update_workspace_access(uuid, timestamptz) from public;
grant execute on function public.update_workspace_access(uuid, timestamptz) to authenticated;

-- Allow direct update policy for platform administrators on businesses table
create policy "platform administrators can update businesses"
on public.businesses
for update
using (public.is_platform_administrator())
with check (public.is_platform_administrator());
