-- Organization-level feature overrides
create table if not exists public.org_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(id)
);

alter table public.org_settings enable row level security;

create policy "Org members can read org settings"
on public.org_settings
for select
to authenticated
using (
  is_platform_admin()
  or exists (
    select 1
    from public.org_memberships om
    where om.org_id = org_settings.org_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

create policy "Org admins and platform admins can upsert org settings"
on public.org_settings
for all
to authenticated
using (is_platform_admin() or is_org_admin(org_id))
with check (is_platform_admin() or is_org_admin(org_id));

create or replace function public.update_org_settings_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists update_org_settings_timestamp on public.org_settings;
create trigger update_org_settings_timestamp
before update on public.org_settings
for each row
execute function public.update_org_settings_updated_at();
