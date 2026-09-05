-- Migration 0171: Catálogo de Produtos da Organização (catalog_products)
-- Portado com isolamento multi-tenant, RLS por role (viewer lê, manager escreve),
-- busca por trigram em nome, SKU único por organização e trigger de updated_at.

create extension if not exists pg_trgm;

create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  codigo text not null,          -- SKU/código interno — identidade do upsert de planilha
  nome text not null,
  descricao text,
  marca text,
  categoria text,
  preco_cents bigint not null,   -- nunca float — preço em centavos
  moeda text not null default 'BRL',
  custo_cents bigint,            -- opcional: piso para regra de desconto do agente
  controla_estoque boolean not null default true, -- false = item que a loja não conta
  quantidade integer not null default 0,
  ativo boolean not null default true,
  origem text not null default 'manual', -- 'manual' | 'planilha' | 'nuvemshop' — vocabulário aberto, sem CHECK
  imagem_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_products_preco_nao_negativo check (preco_cents >= 0),
  constraint catalog_products_custo_nao_negativo check (custo_cents is null or custo_cents >= 0),
  constraint catalog_products_quantidade_nao_negativa check (quantidade >= 0),
  constraint catalog_products_moeda_iso check (moeda ~ '^[A-Z]{3}$')
);

create unique index if not exists catalog_products_org_codigo_key
  on public.catalog_products (organization_id, codigo);
create index if not exists catalog_products_org_ativos_idx
  on public.catalog_products (organization_id, ativo, nome);

-- Índice que faz a busca por token funcionar (parte difusa via trigram).
create index if not exists catalog_products_nome_trgm
  on public.catalog_products using gin (nome public.gin_trgm_ops);

alter table public.catalog_products enable row level security;

drop policy if exists catalog_products_select on public.catalog_products;
create policy catalog_products_select on public.catalog_products
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

drop policy if exists catalog_products_write on public.catalog_products;
create policy catalog_products_write on public.catalog_products
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

revoke all on public.catalog_products from anon;
grant select, insert, update, delete on public.catalog_products to authenticated;
grant all on public.catalog_products to service_role;

drop trigger if exists trg_catalog_products_updated_at on public.catalog_products;
create trigger trg_catalog_products_updated_at
  before update on public.catalog_products
  for each row execute function public.fn_set_updated_at();

notify pgrst, 'reload schema';
