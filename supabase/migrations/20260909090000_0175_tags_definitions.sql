-- 0175: Tabela tags (definição de tags com cor por organização).
-- A cor pertence à definição da tag (org-scoped), não à instância.
-- Instâncias em conversations.tags e contacts.tags continuam text[].
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_org_name_unique unique (organization_id, name)
);

create index if not exists idx_tags_org on public.tags (organization_id);

alter table public.tags enable row level security;

drop policy if exists "tags_select" on public.tags;
create policy "tags_select" on public.tags
  for select using (
    organization_id in (select fn_user_org_ids())
    or fn_is_platform_admin()
  );

drop policy if exists "tags_write" on public.tags;
create policy "tags_write" on public.tags
  for all using (
    (organization_id in (select fn_user_org_ids()) and fn_role_at_least(organization_id, 'agent'))
    or fn_is_platform_admin()
  )
  with check (
    (organization_id in (select fn_user_org_ids()) and fn_role_at_least(organization_id, 'agent'))
    or fn_is_platform_admin()
  );

-- Popula com as tags canônicas já existentes onde houver
insert into public.tags (organization_id, name, color)
select o.id, lower(trim(elem.val)), null
from public.organizations o,
     lateral jsonb_array_elements_text(o.settings->'canonical_conversation_tags') as elem(val)
where jsonb_typeof(o.settings->'canonical_conversation_tags') = 'array'
on conflict (organization_id, name) do nothing;
