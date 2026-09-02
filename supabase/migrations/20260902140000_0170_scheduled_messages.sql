-- 0170: Tabela scheduled_messages (mensagens agendadas com placeholders e disparo automático).
-- RLS por organização: todo membro com papel agent+ pode gerenciar mensagens agendadas.
create table if not exists scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  template_id uuid references message_templates(id) on delete set null,
  raw_body text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  sent_at timestamptz,
  cancelled_at timestamptz,
  error_message text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scheduled_messages_org on scheduled_messages (organization_id);
create index if not exists idx_scheduled_messages_contact on scheduled_messages (contact_id, organization_id, status);
create index if not exists idx_scheduled_messages_pending on scheduled_messages (scheduled_for) where status = 'pending';

alter table scheduled_messages enable row level security;

drop policy if exists "scheduled_messages_select" on scheduled_messages;
create policy "scheduled_messages_select" on scheduled_messages
  for select using (
    organization_id in (select fn_user_org_ids())
    or fn_is_platform_admin()
  );

drop policy if exists "scheduled_messages_write" on scheduled_messages;
create policy "scheduled_messages_write" on scheduled_messages
  for all using (
    (organization_id in (select fn_user_org_ids()) and fn_role_at_least(organization_id, 'agent'))
    or fn_is_platform_admin()
  )
  with check (
    (organization_id in (select fn_user_org_ids()) and fn_role_at_least(organization_id, 'agent'))
    or fn_is_platform_admin()
  );
