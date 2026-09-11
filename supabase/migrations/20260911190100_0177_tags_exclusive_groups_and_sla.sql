-- 0177: Extensão de tags para suporte a grupos exclusivos ("tipo de atendimento"), SLA e CSAT.
-- Permite que uma tag defina o tipo de atendimento, com metas de primeira resposta e resolução.

alter table public.tags
  add column if not exists group_slug text default null,
  add column if not exists is_exclusive boolean not null default false,
  add column if not exists is_csat_enabled boolean not null default false,
  add column if not exists sla_first_response_minutes integer default null,
  add column if not exists sla_resolution_minutes integer default null;

create index if not exists idx_tags_group on public.tags (organization_id, group_slug);

-- Semeia tipos de atendimento padrão como grupo exclusivo para organizações existentes
insert into public.tags (
  organization_id,
  name,
  color,
  group_slug,
  is_exclusive,
  is_csat_enabled,
  sla_first_response_minutes,
  sla_resolution_minutes
)
select 
  o.id,
  t.name,
  t.color,
  'tipo_atendimento',
  true,
  t.csat,
  t.sla_fr,
  t.sla_res
from public.organizations o
cross join (
  values 
    ('suporte', 'azul', true, 60, 1440),
    ('vendas', 'verde', false, 15, 2880),
    ('financeiro', 'amarelo', true, 120, 1440),
    ('duvidas', 'roxo', false, 30, 720)
) as t(name, color, csat, sla_fr, sla_res)
on conflict (organization_id, name) do update set
  group_slug = excluded.group_slug,
  is_exclusive = excluded.is_exclusive,
  is_csat_enabled = excluded.is_csat_enabled,
  sla_first_response_minutes = excluded.sla_first_response_minutes,
  sla_resolution_minutes = excluded.sla_resolution_minutes;
