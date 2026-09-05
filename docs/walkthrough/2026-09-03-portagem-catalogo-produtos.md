# Walkthrough: Portagem do Catálogo de Produtos e Interface Web

> **Data:** 2026-09-03  
> **Status:** Concluído e Validado (Typecheck, Lint e 62/62 Testes Unitários e de Navegação 100% Verdes)

---

## 1. O que foi Implementado

### A. Banco de Dados e Migrations
1. **Migration SQL 0171 & Baseline Idempotente:**
   - Criada a migration `supabase/migrations/20260903080000_0171_catalog_products.sql` e adicionado apêndice idempotente em `supabase/baseline.sql` e entrada no `supabase/migrations/MANIFEST.md`.
   - Tabela `catalog_products` com RLS (`viewer` para leitura, `manager` para escrita), índices únicos e trigram, e trigger `fn_set_updated_at()`.
2. **Auditoria (`AUDIT_ACTIONS`):**
   - Registradas em `lib/audit/actions.ts`: `catalog_product.created`, `catalog_product.updated`, `catalog_product.deleted`, `catalog_product.imported`.

### B. Core e Algoritmos
3. **Core de Busca por Token (`lib/catalogo/busca.ts`):**
   - Implementada tokenização inteligente, descarte de ruído, comparação difusa e eliminação exata de variantes por número ausente.
4. **Parser de Preço e Schemas Zod (`lib/schemas/produtos.ts`):**
   - Função `precoParaCentavos()` com proteção contra texto sujo ou anotações misturadas;
   - Schemas `produtoCreateSchema`, `produtoPatchSchema` e tipagem TypeScript `CatalogProductRow`.
5. **Parser e Validador de Planilha CSV (`lib/catalogo/csv.ts`):**
   - RFC 4180 sem dependências externas, detecção de delimitador (`,`, `;`, `tab`), mapeamento de apelidos de colunas, validação e gerador de modelo CSV.

### C. Route Handlers REST
6. **Endpoints de API (`app/api/v1/products/`):**
   - `GET /api/v1/products`: Listagem filtrada por busca textual e status ativo (`viewer`+);
   - `POST /api/v1/products`: Criação manual de produto (`manager`+) com validação Zod, retorno 409 em código duplicado e auditoria;
   - `GET`, `PATCH` e `DELETE /api/v1/products/[id]`: Gestão individual por ID com checagem de existência e auditoria de mutação;
   - `POST /api/v1/products/import`: Upload de CSV com upsert por `(organization_id, codigo)` e relatório de linhas criadas, atualizadas e rejeitadas;
   - `GET /api/v1/products/template`: Download do modelo oficial `.csv`.

### D. Agente de IA & MCP
7. **Tool MCP do Agente de IA (`lib/mcp/tools/comercio.ts`):**
   - Atualizada a tool `crm_search_products` com busca em `catalog_products`, pontuação em memória, regras de estoque, tratamento de empates e instrução anti-alucinação de preços.

### E. Frontend & Interface do Usuário
8. **Navegação Integrada (`lib/navigation/registry.ts` & `lib/i18n/dicionario.ts`):**
   - Destino `/app/catalogo` adicionado ao grupo `crm` no Sidebar com ícone `Tag`.
   - Tradução `"Catálogo"` catalogada no dicionário da interface.
9. **Página do Catálogo (`app/app/catalogo/page.tsx` & `_client.tsx`):**
   - Listagem em tabela com busca, filtros por status, estoque e badge de ativos.
   - Toggle rápido de ativação/desativação.
   - Modal de criação e edição (`ProductFormDialog`) com preview do preço em R$ em tempo real e erro 409 específico de campo.
   - Modal de importação de planilha (`ImportProductsDialog`) com prévia das primeiras 5 linhas, download de modelo e relatório de processamento.
   - Confirmação de exclusão com alerta destrutivo.

---

## 2. Validações Executadas

- **Typecheck:** `pnpm typecheck` com 0 erros.
- **ESLint:** Sem erros ou advertências em nenhum arquivo novo/modificado.
- **Vitest:** 62/62 testes passando na suíte integrada de produtos e navegação.
