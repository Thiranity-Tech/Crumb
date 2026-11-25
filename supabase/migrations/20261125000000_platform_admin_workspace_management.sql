-- Allow platform administrators to fully manage workspaces: edit name, edit duration, stop access, and delete.

create or replace function public.update_workspace(
  target_business_id uuid,
  new_name text default null,
  new_access_ends_at timestamptz default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_administrator() then
    raise exception 'Platform administrator access required';
  end if;

  update public.businesses
  set
    name = coalesce(nullif(trim(new_name), ''), name),
    access_ends_at = new_access_ends_at
  where id = target_business_id;
end;
$$;

create or replace function public.stop_workspace_access(
  target_business_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_administrator() then
    raise exception 'Platform administrator access required';
  end if;

  update public.businesses
  set access_ends_at = now() - interval '5 seconds'
  where id = target_business_id;
end;
$$;

create or replace function public.delete_workspace(
  target_business_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_administrator() then
    raise exception 'Platform administrator access required';
  end if;

  delete from public.business_members where business_id = target_business_id;
  delete from public.businesses where id = target_business_id;
end;
$$;

revoke all on function public.update_workspace(uuid, text, timestamptz) from public;
grant execute on function public.update_workspace(uuid, text, timestamptz) to authenticated;

revoke all on function public.stop_workspace_access(uuid) from public;
grant execute on function public.stop_workspace_access(uuid) to authenticated;

revoke all on function public.delete_workspace(uuid) from public;
grant execute on function public.delete_workspace(uuid) to authenticated;

-- Policies for platform administrators on businesses and business_members
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'businesses' and policyname = 'platform administrators can delete businesses'
  ) then
    create policy "platform administrators can delete businesses"
    on public.businesses
    for delete
    using (public.is_platform_administrator());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'business_members' and policyname = 'platform administrators can delete business members'
  ) then
    create policy "platform administrators can delete business members"
    on public.business_members
    for delete
    using (public.is_platform_administrator());
  end if;
end;
$$;
