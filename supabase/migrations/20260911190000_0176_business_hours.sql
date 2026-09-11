-- 0176: Tabela business_hours_slots e business_holidays (expediente comercial da organização).
-- Permite que metas de SLA respeitem horário comercial, pausando fora do expediente.

create table if not exists public.business_hours_slots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6), -- 0=Domingo, 1=Segunda, ..., 6=Sábado
  open_time time not null default '08:00:00',
  close_time time not null default '18:00:00',
  is_active boolean not null default true,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_hours_org_day_unique unique (organization_id, day_of_week),
  constraint business_hours_time_order check (close_time > open_time)
);

create index if not exists idx_business_hours_org on public.business_hours_slots (organization_id);

alter table public.business_hours_slots enable row level security;

drop policy if exists "business_hours_slots_select" on public.business_hours_slots;
create policy "business_hours_slots_select" on public.business_hours_slots
  for select using (
    organization_id in (select fn_user_org_ids())
    or fn_is_platform_admin()
  );

drop policy if exists "business_hours_slots_write" on public.business_hours_slots;
create policy "business_hours_slots_write" on public.business_hours_slots
  for all using (
    (organization_id in (select fn_user_org_ids()) and fn_role_at_least(organization_id, 'manager'))
    or fn_is_platform_admin()
  )
  with check (
    (organization_id in (select fn_user_org_ids()) and fn_role_at_least(organization_id, 'manager'))
    or fn_is_platform_admin()
  );

create table if not exists public.business_holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  holiday_date date not null,
  description text,
  created_at timestamptz not null default now(),
  constraint business_holidays_org_date_unique unique (organization_id, holiday_date)
);

create index if not exists idx_business_holidays_org on public.business_holidays (organization_id);

alter table public.business_holidays enable row level security;

drop policy if exists "business_holidays_select" on public.business_holidays;
create policy "business_holidays_select" on public.business_holidays
  for select using (
    organization_id in (select fn_user_org_ids())
    or fn_is_platform_admin()
  );

drop policy if exists "business_holidays_write" on public.business_holidays;
create policy "business_holidays_write" on public.business_holidays
  for all using (
    (organization_id in (select fn_user_org_ids()) and fn_role_at_least(organization_id, 'manager'))
    or fn_is_platform_admin()
  )
  with check (
    (organization_id in (select fn_user_org_ids()) and fn_role_at_least(organization_id, 'manager'))
    or fn_is_platform_admin()
  );

-- Popula com slots padrão (segunda a sexta, 8h às 18h, sáb/dom inativos) para organizações existentes
insert into public.business_hours_slots (organization_id, day_of_week, open_time, close_time, is_active, timezone)
select 
  o.id,
  d.day,
  '08:00:00'::time,
  '18:00:00'::time,
  case when d.day between 1 and 5 then true else false end,
  coalesce(nullif(trim(o.settings->>'timezone'), ''), 'America/Sao_Paulo')
from public.organizations o
cross join (values (0), (1), (2), (3), (4), (5), (6)) as d(day)
on conflict (organization_id, day_of_week) do nothing;
