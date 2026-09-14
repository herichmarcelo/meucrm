# Arquitetura do Catálogo de Produtos

> **Propósito:** Gestão própria de catálogo de produtos da organização, suportando cadastro manual, importação via planilha, precificação segura em centavos, controle de estoque opcional, busca semântica por token com eliminação numérica exata e integração nativa com o agente de IA e ferramentas MCP.

---

## 1. Visão Geral e Decisões de Design

O catálogo de produtos (`catalog_products`) foi portado de forma desacoplada da tabela `nuvemshop_products` (espelho de loja remota). Essa separação garante:
1. **Segurança e RBAC:** Somente usuários com role `manager` ou superior podem criar, alterar ou excluir produtos e preços. Usuários com role `viewer` possuem permissão estrita de leitura.
2. **Monetização e Preço Seguro:** Preços são armazenados exclusivamente como inteiros em centavos (`preco_cents`, `custo_cents`), eliminando erros de ponto flutuante.
3. **Controle de Estoque Flexível:** Flag `controla_estoque` permite que itens de serviço ou sob encomenda apareçam nas respostas do assistente sem depender de contagem de inventário.
4. **Resolução de SKU/Código Único:** Constraint única `(organization_id, codigo)` assegura identidade determinística para upserts em importações de planilhas.

---

## 2. Schema SQL e RLS

Tabela: `public.catalog_products` (definida na migration `20260903080000_0171_catalog_products.sql` e apêndice do `baseline.sql`):

```sql
create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  codigo text not null,          -- SKU/código interno
  nome text not null,
  descricao text,
  marca text,
  categoria text,
  preco_cents bigint not null,   -- Preço em centavos
  moeda text not null default 'BRL',
  custo_cents bigint,            -- Piso para margem
  controla_estoque boolean not null default true,
  quantidade integer not null default 0,
  ativo boolean not null default true,
  origem text not null default 'manual', -- 'manual' | 'planilha' | 'nuvemshop'
  imagem_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_products_preco_nao_negativo check (preco_cents >= 0),
  constraint catalog_products_custo_nao_negativo check (custo_cents is null or custo_cents >= 0),
  constraint catalog_products_quantidade_nao_negativa check (quantidade >= 0),
  constraint catalog_products_moeda_iso check (moeda ~ '^[A-Z]{3}$')
);
```

### Índices
- `catalog_products_org_codigo_key` UNIQUE `(organization_id, codigo)`
- `catalog_products_org_ativos_idx` `(organization_id, ativo, nome)`
- `catalog_products_nome_trgm` GIN `(nome public.gin_trgm_ops)`

### Políticas RLS
- **SELECT (`catalog_products_select`):** `(organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()`
- **WRITE (`catalog_products_write`):** `public.fn_is_platform_admin() or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'manager'))`

---

## 3. Algoritmo de Busca por Token (`lib/catalogo/busca.ts`)

O mecanismo de busca por token resolve ambiguidades e buscas imperfeitas dos clientes com duas regras fundamentais:

1. **PALAVRA é Difusa (Fuzzy Matching):**
   - Normalização NFD para remoção de acentos e pontuação;
   - Descarte de palavras de ruído (`de`, `do`, `da`, `com`, `para`, `por`, `the`, `e`, `o`, `a`, `um`, `uma`);
   - Comparação exata (nota 1.0), prefixos (0.9), e distância de Levenshtein calibrada (0.75 a 0.5) com bônus para mesma letra inicial (ex: *"ifone"* pontua alto para *"iPhone"*).
2. **NÚMERO é Exato (Eliminação Determinística):**
   - Se o cliente menciona uma especificação numérica (ex: *"256GB"*, *"128"*, *"15"*), o produto DEVE conter exatamente esse número isolado ou com sufixo de unidade.
   - Produtos que não possuem o número são **ELIMINADOS** da lista de resultados, impedindo que um *"iPhone 128GB"* seja ofertado quando o cliente pediu explicitamente *"256GB"*.

---

## 4. Parser de Preço com Proteção contra Texto Sujo (`lib/schemas/produtos.ts`)

A função `precoParaCentavos(entrada: string)` converte representações monetárias em centavos:
- Reconhece formatos brasileiros (`5.499,00`, `120,50`, `R$ 99,90`) e internacionais (`5499.00`, `USD 100.50`).
- **Defesa contra concatenação espúria:** Rejeita strings com texto livre ou observações coladas aos números (ex: `"R$ 5.499,00 (promo até 10)"` retorna `null` em vez de concatenar `54990010`).

---

## 5. Integração com MCP e Agente de IA (`lib/mcp/tools/comercio.ts`)

A tool `crm_search_products` expõe o catálogo para o agente:
- Consulta produtos ativos da organização;
- Ranqueia em memória via `ordenarPorRelevancia`;
- Filtra disponibilidade: produtos com `controla_estoque = false` sempre aparecem; produtos com `controla_estoque = true` exigem `quantidade > 0`;
- Se houver empate na nota máxima entre variantes, retorna `empate: true` e instrução explícita para o assistente perguntar qual o cliente deseja;
- Se não houver produtos compatíveis, instrui o assistente a não inventar preços nem itens.

---

## 6. Interface Frontend e Gestão do Catálogo (`app/app/catalogo/`)

A interface foi implementada respeitando o Design System do produto (Sage, Tailwind, Radix/shadcn, Phosphor Icons) e a governança de navegação centralizada:

1. **Navegação & Sidebar:**
   - Adicionada ao grupo `crm` no registro (`lib/navigation/registry.ts`) com rota `/app/catalogo` e ícone `Tag`.
   - Chave de internacionalização catalogada em `lib/i18n/dicionario.ts`.
2. **Listagem e Tabela (`CatalogListClient`):**
   - Exibe Código (SKU), Nome/Descrição, Marca/Categoria, Preço formatado em R$, Estoque com badges contextuais e Status Ativo/Inativo.
   - Busca textual com debounce (`GET /api/v1/products?busca=...`) e filtro por status ativo.
   - Toggle rápido de ativação/desativação via `PATCH /api/v1/products/[id]`.
3. **Formulário de Cadastro/Edição (`ProductFormDialog`):**
   - Inputs completos com conversão em tempo real de centavos para R$ no preview.
   - Tratamento específico de erro `409 Conflict` (SKU duplicado) com destaque no campo de código.
4. **Importador de Planilha CSV (`ImportProductsDialog`):**
   - Upload de arquivo `.csv` (RFC 4180) com delimitador automático (`,`, `;` ou `tab`).
   - Prévia das primeiras 5 linhas antes de confirmar.
   - Botão para baixar modelo oficial de planilha (`GET /api/v1/products/template`).
   - Relatório pós-importação com total lido, criados, atualizados e linhas rejeitadas com motivo nominal.

---

## 7. Envio pelo Atendente Humano no Composer (`AttachMenu` + `CatalogPickerDialog`)

Para permitir que atendentes humanos enviem ofertas e produtos diretamente na conversa sem digitar detalhes manualmente, o catálogo foi integrado à barra de anexos do Composer:

### 7.1. Regra de Ouro: Reuso Estrito do Motor de Relevância
A busca executada pelo atendente humano **reaproveita exatamente a mesma função** (`ordenarPorRelevancia` / `pontuar` em `lib/catalogo/busca.ts`) que a ferramenta MCP da IA consome.
- **Paridade de Comportamento:** Se o atendente digitar *"ifone 15 256"*, o algoritmo elimina modelos de 128GB, tolera a grafia imperfeita de *"ifone"* e preserva empates entre variantes idênticas. Nenhuma consulta simplificada com `ilike` ou motor paralelo é utilizada.

### 7.2. Endpoint de Busca (`GET /api/v1/catalog/search`)
- **Parâmetros:** `q` (termo de busca) e `limite` (padrão 10, máx 50).
- **RBAC:** `requireRole("viewer")` — permite que qualquer atendente (`agent` ou superior) busque e consulte itens sem barreiras indevidas de permissão.
- **Consulta:** Carrega produtos ativos (`ativo = true`) da organização corrente (`org.orgId`).
- **Classificação:** Se houver termo de busca `q`, processa via `ordenarPorRelevancia`; se vazio, lista os produtos por ordem alfabética de nome.
- **Payload Retornado:**
  ```json
  {
    "data": [
      {
        "id": "uuid",
        "codigo": "IP15-128",
        "nome": "Apple iPhone 15 128GB Preto",
        "descricao": "...",
        "marca": "Apple",
        "categoria": "Smartphones",
        "preco_cents": 499900,
        "preco_formatado": "R$ 4.999,00",
        "moeda": "BRL",
        "controla_estoque": true,
        "quantidade": 5,
        "disponivel": true,
        "imagem_url": "https://...",
        "relevancia": 0.95
      }
    ]
  }
  ```

### 7.3. Componente `CatalogPickerDialog` e Fluxo no Composer
1. **Menu "+" (`AttachMenu`):** Exibe o botão **Catálogo** com ícone Phosphor `ShoppingBag` estilizado em padrão duotone/primary consistente com Fotos, Documento e Contato.
2. **Modal de Busca:**
   - Input com busca debounced (300ms) consumindo o hook `useCatalogSearch(debounced)`.
   - Miniatura da foto do produto (com fallback elegante para ícone quando não há imagem).
   - Nome, código/SKU, marca e categoria.
   - Preço em destaque formatado em reais.
   - Badge visual **"Sem estoque"** quando `disponivel = false`, **mantendo o produto selecionável** para que o atendente possa enviar informações e negociar prazos/reposição com o cliente.
3. **Envio Imediato no Clique:**
   - **Produto com foto (`imagem_url` preenchido):** Enviado via `send.mutate({ type: "image", media_url, media_mime, body })` onde `body` é formatado como:
     ```text
     *Nome do Produto*
     R$ 4.999,00
     ```
     O backend encaminha a URL direta com o caption para o canal (GOWA / WAHA / Meta).
   - **Produto sem foto:** Enviado via `send.mutate({ type: "text", body })` com o mesmo texto formatado.
   - **Assinatura do Atendente:** O backend (`sendMessageHandler`) prefixa a assinatura configurada do usuário (`*Atendente:*\n...`) de forma transparente em qualquer envio com `body`.
   - **Fechamento:** O modal é fechado instantaneamente no envio bem-sucedido.

---

## 8. Testes e Validações Automatizadas

- **`tests/unit/api-catalog-search.test.ts`**: Valida a rota HTTP garantindo exclusão de variantes incompatíveis por número, tolerância a digitação ("ifone"), formatação correta de centavos para R$, flags de disponibilidade de estoque e autorização RBAC.
- **`tests/unit/catalog-picker-dialog.test.tsx`**: Valida renderização, pesquisa debounced, badge de estoque sem bloqueio de clique e disparo do callback `onPick`.
- **`tests/unit/composer-attach.test.tsx`**: Valida presença do item no menu `+` e envios diferenciados (foto com legenda vs. texto puro).
