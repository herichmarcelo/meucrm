# Regras de Negócio: Instâncias Nomeadas e Segmentação por Equipes

> **Status:** CONFIRMADO  
> **Módulo:** Canais / Conexões WhatsApp (GOWA / WAHA) / Filas de Atendimento  
> **Objetivo:** Definir nomes de instâncias para identificar equipes de atendimento (ex: "João atende pela instância VENDEDORES").

---

## 1. Contexto e Motivação

Em operações comerciais e de suporte, uma mesma organização no CRM pode possuir múltiplos números de WhatsApp conectados simultaneamente. Cada número geralmente atende a um departamento, filial ou time específico:
- **Exemplo 1:** Instância `VENDEDORES` (Equipe Comercial / SDRs).
- **Exemplo 2:** Instância `SUPORTE` (Helpdesk / Atendimento ao Cliente).
- **Exemplo 3:** Instância `FINANCEIRO` (Cobrança e Faturamento).

A identificação clara da instância pelo seu **Nome/Apelido** (`display_name`) evita que operadores atendam canais incorretos e permite a segmentação automatizada de filas.

---

## 2. Regras de Negócio

### RN-01: Definição do Nome da Instância na Criação
- Ao clicar em **"+ Conectar novo WhatsApp"**, o sistema abre um diálogo solicitando o **Nome da Instância / Equipe** (campo opcional, tamanho máximo de 80 caracteres).
- Caso informado (ex: `VENDEDORES`), o valor é salvo no campo `display_name` da tabela `channel_sessions`.
- Se não for informado no momento da criação, o CRM utiliza o formato padrão `+<telefone>` ou `Número sem nome`.

### RN-02: Renomeação e Edição a Qualquer Momento
- Qualquer canal conectado na Central de Conexões possui um botão de edição (**ícone de lápis**) ao lado do nome.
- O administrador da organização pode renomear a instância a qualquer momento via `PATCH /api/v1/channel-sessions/[id]` enviando `{ "display_name": "NOVO NOME" }`.
- A alteração é refletida em tempo real na listagem de conexões, nos cabeçalhos de chat e nos seletores do Inbox.

### RN-03: Alocação de Atendentes por Instância
- Cada atendente (ex: `João`) pode ser vinculado à equipe/fila da instância `VENDEDORES`.
- Conversas que chegam através daquela instância específica são direcionadas preferencialmente ou exclusivamente aos atendentes autorizados para aquela instância.

### RN-04: Resolução de Alertas de Conexão
- Quando uma conexão estiver com status `STOPPED`, `FAILED` ou `SCAN_QR_CODE`, o aviso no topo do sistema utilizará o nome da instância (ex: `"WhatsApp VENDEDORES está desconectado"`) em vez de `"WhatsApp sem nome está desconectado"`.

---

## 3. Estrutura de Dados e Endpoints

### Tabela `channel_sessions`
- `id` (UUID): Identificador único da sessão.
- `provider` (text): `gowa` | `waha` | `meta_cloud` | `zernio`.
- `display_name` (text, nullable): Nome da instância definido pelo usuário (ex: `VENDEDORES`).
- `phone_number` (text, nullable): Número do WhatsApp pareado em formato E.164.
- `status` (text): Status da sessão (`STARTING`, `SCAN_QR_CODE`, `WORKING`, `STOPPED`, `FAILED`).

### Endpoints REST
- `POST /api/v1/channel-sessions`: Cria uma nova sessão com payload `{ "display_name": "VENDEDORES", "provider": "gowa" }`.
- `PATCH /api/v1/channel-sessions/[id]`: Atualiza o nome da instância com payload `{ "display_name": "NOVO_NOME" }`.
- `GET /api/v1/channel-sessions`: Lista todas as sessões ativas da organização ativa com seus respectivos nomes e status.
