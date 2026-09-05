-- Migration 0172: Tipos de Atendimento (service_types) e Agendamentos (appointments)
-- Suporte ao fluxo de IA que marca consultas, calcula horários livres e move leads no funil.

create table if not exists public.service_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null default 30,
  price_cents bigint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_types_duration_positive check (duration_minutes > 0),
  constraint service_types_price_non_negative check (price_cents >= 0)
);

create unique index if not exists service_types_org_name_key
  on public.service_types (organization_id, name);
create index if not exists service_types_org_active_idx
  on public.service_types (organization_id, active, name);

alter table public.service_types enable row level security;

drop policy if exists service_types_select on public.service_types;
create policy service_types_select on public.service_types
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

drop policy if exists service_types_write on public.service_types;
create policy service_types_write on public.service_types
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.service_types from anon;
grant select, insert, update, delete on public.service_types to authenticated;
grant all on public.service_types to service_role;

drop trigger if exists trg_service_types_updated_at on public.service_types;
create trigger trg_service_types_updated_at
  before update on public.service_types
  for each row execute function public.fn_set_updated_at();

-- Agendamentos de Atendimento / Consultas
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  service_type_id uuid references public.service_types(id) on delete set null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 30,
  status text not null default 'pending',
  notes text,
  created_by_kind text not null default 'agent',
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_status_check check (status in ('pending', 'confirmed', 'attended', 'no_show', 'canceled')),
  constraint appointments_created_by_kind_check check (created_by_kind in ('agent', 'user', 'contact')),
  constraint appointments_duration_positive check (duration_minutes > 0)
);

create index if not exists appointments_org_scheduled_idx
  on public.appointments (organization_id, scheduled_at);
create index if not exists appointments_org_contact_idx
  on public.appointments (organization_id, contact_id);
create index if not exists appointments_org_status_idx
  on public.appointments (organization_id, status);

alter table public.appointments enable row level security;

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

drop policy if exists appointments_write on public.appointments;
create policy appointments_write on public.appointments
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'viewer'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'viewer'))
  );

revoke all on public.appointments from anon;
grant select, insert, update, delete on public.appointments to authenticated;
grant all on public.appointments to service_role;

drop trigger if exists trg_appointments_updated_at on public.appointments;
create trigger trg_appointments_updated_at
  before update on public.appointments
  for each row execute function public.fn_set_updated_at();

notify pgrst, 'reload schema';
