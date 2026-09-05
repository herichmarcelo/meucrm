-- 0174 — vocabulário do canal de Instagram Direct em channel_sessions e contacts.
--
-- Adiciona suporte ao sexto ChannelProvider ('instagram') no banco de dados.
-- O canal de Instagram opera via Meta Graph API / Messenger Platform e se identifica
-- por `instagram_account_id` (IGSID da conta profissional do Instagram).
--
-- Idempotente e auto-curativa:
-- 1. Cria as colunas `instagram_account_id`, `instagram_page_id`, `instagram_username`, `instagram_token_encrypted` em channel_sessions.
-- 2. Atualiza `channel_sessions_provider_check` com 'instagram'.
-- 3. Atualiza `channel_sessions_provider_ref_check` com o ramo 'instagram'.
-- 4. Cria índice único parcial para `instagram_account_id` entre canais ativos.
-- 5. Cria as colunas `instagram_id` e `instagram_username` na tabela contacts.

alter table public.channel_sessions
  add column if not exists instagram_account_id text,
  add column if not exists instagram_page_id text,
  add column if not exists instagram_username text,
  add column if not exists instagram_token_encrypted text;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
  check (provider = any (array['waha'::text, 'meta_cloud'::text, 'zernio'::text, 'gowa'::text, 'email'::text, 'instagram'::text]));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha'       and waha_session_name      is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id   is not null) or
    (provider = 'zernio'     and zernio_account_id      is not null) or
    (provider = 'gowa'       and gowa_device_id         is not null) or
    (provider = 'email'      and email_inbound_address  is not null) or
    (provider = 'instagram'  and instagram_account_id   is not null)
  );

create unique index if not exists channel_sessions_instagram_account_id_ativo_unique
  on public.channel_sessions (instagram_account_id)
  where archived_at is null and instagram_account_id is not null;

comment on column public.channel_sessions.instagram_account_id is
  'ID da conta profissional do Instagram (IGSID) associada a esta sessão de canal.';

comment on column public.channel_sessions.instagram_username is
  'Handle/nome de usuário (@usuario) do Instagram associado a esta sessão.';

-- Colunas na tabela de contatos para identificação por Instagram
alter table public.contacts
  add column if not exists instagram_id text,
  add column if not exists instagram_username text;

create index if not exists idx_contacts_org_instagram_id
  on public.contacts (organization_id, instagram_id)
  where instagram_id is not null;
