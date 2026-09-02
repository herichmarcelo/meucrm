-- 0169 — vocabulário do canal GOWA (Go WhatsApp Web MultiDevice) em channel_sessions.
--
-- Adiciona suporte ao quarto ChannelProvider ('gowa') no banco de dados.
-- O GOWA opera via protocolo multi-device (Baileys em Go) e se comunica
-- por REST HTTP + Basic Auth, indexado por `gowa_device_id`.
--
-- Idempotente e auto-curativa:
-- 1. Cria a coluna `gowa_device_id` (nullable).
-- 2. Atualiza `channel_sessions_provider_check` com 'gowa'.
-- 3. Atualiza `channel_sessions_provider_ref_check` com o ramo 'gowa'.
-- 4. Cria índice único parcial para `gowa_device_id` entre canais ativos.

alter table public.channel_sessions
  add column if not exists gowa_device_id text;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
  check (provider = any (array['waha'::text, 'meta_cloud'::text, 'zernio'::text, 'gowa'::text]));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha'       and waha_session_name    is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id is not null) or
    (provider = 'zernio'     and zernio_account_id    is not null) or
    (provider = 'gowa'       and gowa_device_id       is not null)
  );

create unique index if not exists channel_sessions_gowa_device_id_ativo_unique
  on public.channel_sessions (gowa_device_id)
  where archived_at is null and gowa_device_id is not null;

comment on column public.channel_sessions.gowa_device_id is
  'Identificador do device no GOWA (device_id), usado no header X-Device-Id para rotear mensagens e comandos.';
