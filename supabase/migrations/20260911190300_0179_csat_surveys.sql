-- 0179: Tabela csat_surveys para pesquisa de satisfação segmentada (WhatsApp e E-mail).
create table if not exists public.csat_surveys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  demanda_id uuid references public.demandas(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'email')),
  score integer check (score between 1 and 5),
  comment text,
  token text unique not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'expired')),
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_csat_surveys_org on public.csat_surveys (organization_id);
create index if not exists idx_csat_surveys_token on public.csat_surveys (token);
create index if not exists idx_csat_surveys_demanda on public.csat_surveys (demanda_id);
create index if not exists idx_csat_surveys_conversation on public.csat_surveys (conversation_id);

alter table public.csat_surveys enable row level security;

drop policy if exists "csat_surveys_select" on public.csat_surveys;
create policy "csat_surveys_select" on public.csat_surveys
  for select using (
    organization_id in (select fn_user_org_ids())
    or fn_is_platform_admin()
  );

drop policy if exists "csat_surveys_write" on public.csat_surveys;
create policy "csat_surveys_write" on public.csat_surveys
  for all using (
    (organization_id in (select fn_user_org_ids()) and fn_role_at_least(organization_id, 'manager'))
    or fn_is_platform_admin()
  )
  with check (
    (organization_id in (select fn_user_org_ids()) and fn_role_at_least(organization_id, 'manager'))
    or fn_is_platform_admin()
  );

-- Tabela csat_config: tempo de espera e limite de frequência por contato
create table if not exists public.csat_config (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tag_id uuid references public.tags(id) on delete cascade,
  delay_minutes integer not null default 0,
  max_frequency_days integer not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_csat_config_org on public.csat_config (organization_id);

create unique index if not exists idx_csat_config_org_default
  on public.csat_config (organization_id)
  where tag_id is null;

create unique index if not exists idx_csat_config_org_tag
  on public.csat_config (organization_id, tag_id)
  where tag_id is not null;

alter table public.csat_config enable row level security;

drop policy if exists "csat_config_select" on public.csat_config;
create policy "csat_config_select" on public.csat_config
  for select using (
    organization_id in (select fn_user_org_ids())
    or fn_is_platform_admin()
  );

drop policy if exists "csat_config_write" on public.csat_config;
create policy "csat_config_write" on public.csat_config
  for all using (
    (organization_id in (select fn_user_org_ids()) and fn_role_at_least(organization_id, 'manager'))
    or fn_is_platform_admin()
  )
  with check (
    (organization_id in (select fn_user_org_ids()) and fn_role_at_least(organization_id, 'manager'))
    or fn_is_platform_admin()
  );

-- Popula com configuração padrão de CSAT para organizações existentes
insert into public.csat_config (organization_id, tag_id, delay_minutes, max_frequency_days)
select id, null, 0, 30
from public.organizations
on conflict do nothing;

