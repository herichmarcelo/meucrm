-- 0178: Rastreio de SLA em demandas e suporte a pausa de relógio.
-- O relógio pausa enquanto a demanda estiver no estado 'aguardando_cliente'.
-- A primeira conversa vinculada define o tipo de atendimento e as metas.

alter table public.demandas
  add column if not exists primeira_resposta_em timestamptz default null,
  add column if not exists sla_paused_at timestamptz default null,
  add column if not exists sla_total_paused_seconds integer not null default 0,
  add column if not exists sla_first_response_target_minutes integer default null,
  add column if not exists sla_resolution_target_minutes integer default null,
  add column if not exists sla_first_response_breached boolean not null default false,
  add column if not exists sla_resolution_breached boolean not null default false,
  add column if not exists sla_breached_at timestamptz default null;

create index if not exists idx_demandas_sla_paused
  on public.demandas (organization_id, sla_paused_at)
  where sla_paused_at is not null;

create index if not exists idx_demandas_sla_primeira_resposta
  on public.demandas (organization_id, primeira_resposta_em)
  where primeira_resposta_em is null;
