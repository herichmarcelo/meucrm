-- 0173 — vocabulário do canal de E-mail em channel_sessions.
--
-- Adiciona suporte ao quinto ChannelProvider ('email') no banco de dados.
-- O canal de e-mail opera via Resend / Inbound webhook e se identifica
-- por `email_inbound_address` (ex: atendimento@empresa.com.br).
--
-- Idempotente e auto-curativa:
-- 1. Cria a coluna `email_inbound_address` (nullable).
-- 2. Atualiza `channel_sessions_provider_check` com 'email'.
-- 3. Atualiza `channel_sessions_provider_ref_check` com o ramo 'email'.
-- 4. Cria índice único parcial para `email_inbound_address` entre canais ativos.

alter table public.channel_sessions
  add column if not exists email_inbound_address text;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
  check (provider = any (array['waha'::text, 'meta_cloud'::text, 'zernio'::text, 'gowa'::text, 'email'::text]));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha'       and waha_session_name      is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id   is not null) or
    (provider = 'zernio'     and zernio_account_id      is not null) or
    (provider = 'gowa'       and gowa_device_id         is not null) or
    (provider = 'email'      and email_inbound_address  is not null)
  );

create unique index if not exists channel_sessions_email_inbound_address_ativo_unique
  on public.channel_sessions (email_inbound_address)
  where archived_at is null and email_inbound_address is not null;

comment on column public.channel_sessions.email_inbound_address is
  'Endereço de e-mail de entrada / remetente associado a esta sessão de canal.';
