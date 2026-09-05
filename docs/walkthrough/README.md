# Walkthroughs & Relatórios de Entrega — DeskcommCRM

Esta pasta armazena o histórico e relatórios detalhados de implementações, refatorações e avanços técnicos entregues no projeto.

## Índice de Walkthroughs

| Data | Arquivo | Módulo / Escopo |
| :--- | :--- | :--- |
| 2026-09-02 | [`2026-09-02-sincronizacao-fotos-perfil-waha-gowa.md`](2026-09-02-sincronizacao-fotos-perfil-waha-gowa.md) | Sincronização de fotos de perfil (WAHA/GOWA), upload no bucket `whatsapp-media` e rota sob demanda. |
| 2026-09-02 | [`2026-09-02-mensagens-agendadas.md`](2026-09-02-mensagens-agendadas.md) | Mensagens Agendadas no WhatsApp com placeholders dinâmicos, integração com Composer, sidebar do contato e cron worker. |
| 2026-09-02 | [`2026-09-02-fuso-horario-e-formato-hora.md`](2026-09-02-fuso-horario-e-formato-hora.md) | Fuso Horário (`America/Campo_Grande` e regionais), formato 24h / 12h AM-PM no perfil e propagação global. |
| 2026-09-02 | [`2026-09-02-assinatura-conversa.md`](2026-09-02-assinatura-conversa.md) | Assinatura na Conversa (`*{assinatura}:*`) no perfil do atendente, injeção no WhatsApp e isolamento de IA. |
| 2026-09-02 | [`2026-09-02-nome-vs-display-name.md`](2026-09-02-nome-vs-display-name.md) | Precedência de Nome (`name`) sobre Display Name (`display_name`) e sincronização no CRM. |
| 2026-09-02 | [`2026-09-02-reabertura-e-reaproveitamento-mensagens-agendadas.md`](2026-09-02-reabertura-e-reaproveitamento-mensagens-agendadas.md) | Reabertura, edição, alteração de horário e reaproveitamento de mensagens agendadas na barra lateral do CRM. |
| 2026-09-02 | [`2026-09-02-persistencia-midias-e-fotos-perfil-supabase.md`](2026-09-02-persistencia-midias-e-fotos-perfil-supabase.md) | Persistência oportunista de mídias (áudios, imagens, vídeos, documentos) e sincronização de fotos de perfil no Supabase Storage. |
| 2026-09-03 | [`2026-09-03-portagem-catalogo-produtos.md`](2026-09-03-portagem-catalogo-produtos.md) | Portagem do Catálogo de Produtos (`catalog_products`), busca por tokens, parser de preços em centavos e MCP tool `crm_search_products`. |
| 2026-09-03 | [`2026-09-03-padronizacao-modais-confirmacao.md`](2026-09-03-padronizacao-modais-confirmacao.md) | Padronização de Diálogos de Confirmação com `<ConfirmDialog />` e eliminação de `window.confirm()` em todo o sistema. |
| 2026-09-05 | [`2026-09-05-suporte-exibicao-gifs-animados.md`](2026-09-05-suporte-exibicao-gifs-animados.md) | Suporte e exibição de GIFs animados no WhatsApp e Inbox (loop silencioso na bolha e rótulo `GIF` na lista de conversas). |


