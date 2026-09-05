import { beforeEach, describe, expect, it, vi } from "vitest";

import { listConversationsHandler, termoSeguroParaOr } from "@/app/api/v1/conversations/_handler";

interface Chamada {
  tabela: string;
  metodo: string;
  args: unknown[];
}

function fakeSupabase(contatosEncontrados: Array<{ id: string }>) {
  const chamadas: Chamada[] = [];
  const client = {
    from: (tabela: string) => {
      const proxy: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") {
              return (ok: (v: unknown) => unknown) =>
                ok({ data: tabela === "contacts" ? contatosEncontrados : [], error: null });
            }
            return (...args: unknown[]) => {
              chamadas.push({ tabela, metodo: String(prop), args });
              return proxy;
            };
          },
        },
      );
      return proxy;
    },
  };
  return { client: client as never, chamadas };
}

const ctx = {
  organization_id: "org-1",
  requestId: "req-1",
  actor: { type: "user" as const, id: "user-1" },
} as never;

async function buscar(search: string, contatos: Array<{ id: string }> = []) {
  const { client, chamadas } = fakeSupabase(contatos);
  await listConversationsHandler(client, ctx, { limit: 50, search } as never);
  return chamadas;
}

const args = (c: Chamada[], tabela: string, metodo: string) =>
  c.filter((x) => x.tabela === tabela && x.metodo === metodo).flatMap((x) => x.args).join(" | ");

beforeEach(() => vi.clearAllMocks());

describe("termoSeguroParaOr", () => {
  it("sanitiza vírgulas, parênteses e caracteres curinga", () => {
    expect(termoSeguroParaOr("Silva, Joao")).toBe("Silva* Joao");
    expect(termoSeguroParaOr("Teste (SP)")).toBe("Teste *SP*");
    expect(termoSeguroParaOr("100%_concluido")).toBe("100\\%\\_concluido");
  });
});

describe("busca do inbox — o contato entra no predicado", () => {
  it("o nome do cliente encontra a conversa, mesmo sem aparecer em mensagem nenhuma", async () => {
    const c = await buscar("Maria", [{ id: "contato-maria" }]);

    const nomes = args(c, "contacts", "or");
    expect(nomes).toContain("display_name");
    expect(nomes).toContain("name");
    expect(args(c, "contacts", "eq")).toContain("org-1");
    expect(c.some((x) => x.tabela === "contacts" && x.metodo === "limit")).toBe(true);

    const filtro = args(c, "conversations", "or");
    expect(filtro).toContain("contato-maria");
    expect(filtro).toContain("last_message_preview");
  });

  it("contato anonimizado não volta a ser encontrável pelo nome antigo", async () => {
    const c = await buscar("Maria", [{ id: "contato-maria" }]);
    const filtros = c.filter((x) => x.tabela === "contacts");
    const texto = JSON.stringify(filtros);
    expect(texto).toContain("is_anonymized");
  });

  it("telefone com 4 ou mais dígitos procura o número", async () => {
    const c = await buscar("991234567", [{ id: "contato-tel" }]);
    expect(args(c, "contacts", "or")).toContain("phone_number");
  });

  it("termo com menos de 4 dígitos não vira busca de telefone", async () => {
    const c = await buscar("12", []);
    expect(args(c, "contacts", "or")).not.toContain("phone_number");
  });

  it("sem contato casado, a busca por conteúdo segue sozinha", async () => {
    const c = await buscar("orçamento", []);
    const conv = c.filter((x) => x.tabela === "conversations");
    const texto = JSON.stringify(conv);
    expect(texto).toContain("last_message_preview");
    expect(texto).not.toContain("contact_id.in.()");
  });
});

describe("a tela promete o que a busca entrega", () => {
  it("o campo não diz mais apenas 'Buscar mensagens'", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const fonte = readFileSync(
      join(process.cwd(), "components/inbox/InboxFilters.tsx"),
      "utf8",
    );
    expect(fonte).toContain("placeholder=");
    expect(fonte).toContain("Buscar por nome, telefone ou mensagem");
  });
});
