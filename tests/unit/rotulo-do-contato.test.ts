import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { ehIdentificadorTecnico, rotuloDoContato, SEM_NOME } from "@/lib/contacts/rotulo-do-contato";

/**
 * COMO SE CHAMA ESTA PESSOA NA TELA.
 *
 * Dois grupos, e o segundo é o que importa a longo prazo:
 *
 *  1. a REGRA — identificador técnico nunca vira nome, telefone é melhor que
 *     "Sem nome", e nome legítimo não é confundido com id;
 *  2. a UNICIDADE — nenhuma tela nova volta a escrever a própria cadeia. Sem
 *     este segundo grupo, a função central vira a sétima cópia em vez de
 *     substituir as seis.
 */

describe("ehIdentificadorTecnico", () => {
  it("reconhece os sufixos de endereçamento do WhatsApp", () => {
    expect(ehIdentificadorTecnico("Contato 543134@lid")).toBe(true);
    expect(ehIdentificadorTecnico("5531988887777@c.us")).toBe(true);
    expect(ehIdentificadorTecnico("120363@g.us")).toBe(true);
    expect(ehIdentificadorTecnico("558183647258@s.whatsapp.net")).toBe(true);
  });

  it("reconhece o rótulo que o código antigo inventava", () => {
    // Duas formas conviviam na produção — duas versões do mesmo bug.
    expect(ehIdentificadorTecnico("Contato 900928")).toBe(true);
    expect(ehIdentificadorTecnico("Contato 543134@lid")).toBe(true);
  });

  it("NÃO confunde nome de gente com identificador", () => {
    // Recusar um nome legítimo é pior que deixar passar um técnico: apaga a
    // identidade de uma pessoa real da tela de quem a atende.
    expect(ehIdentificadorTecnico("Contato Comercial da Loja")).toBe(false);
    expect(ehIdentificadorTecnico("Kaio Gomes")).toBe(false);
    expect(ehIdentificadorTecnico("Ana")).toBe(false);
    expect(ehIdentificadorTecnico("Loja 24h")).toBe(false);
    expect(ehIdentificadorTecnico("Contato 2 da obra"), "dígito no meio não é id").toBe(false);
  });
});

describe("rotuloDoContato", () => {
  it("prefere o nome formal cadastrado no CRM (name) sobre o display_name (pushName do WhatsApp)", () => {
    expect(
      rotuloDoContato({ display_name: "Wl", name: "Wesley Lopes", phone_number: "+556796158752" }),
    ).toBe("Wesley Lopes");
  });

  it("usa display_name quando name for nulo ou vazio", () => {
    expect(
      rotuloDoContato({ display_name: "Wl", name: null, phone_number: "+556796158752" }),
    ).toBe("Wl");
    expect(
      rotuloDoContato({ display_name: "Wl", name: "   ", phone_number: "+556796158752" }),
    ).toBe("Wl");
  });

  it("pula o display_name TÉCNICO e usa o que vier depois", () => {
    // Era o caso vivo na produção: 3 contatos com o rótulo inventado gravado.
    // Sem esta regra, consertar o título do lead para ler do cadastro faria
    // `Contato 543134@lid` aparecer no card do kanban.
    expect(
      rotuloDoContato({ display_name: "Contato 543134@lid", name: null, phone_number: "+5531988887777" }),
    ).toBe("+5531988887777");
  });

  it("o TELEFONE vale mais que 'Sem nome' — e duas telas o ignoravam", () => {
    expect(rotuloDoContato({ display_name: null, name: null, phone_number: "+5531988887777" })).toBe(
      "+5531988887777",
    );
  });

  it("o E-MAIL vale mais que 'Sem nome' quando não há telefone nem nome", () => {
    expect(
      rotuloDoContato({ display_name: null, name: null, phone_number: null, email: "cliente@empresa.com" }),
    ).toBe("cliente@empresa.com");
  });

  it("sem nada apresentável, UM literal — não quatro", () => {
    expect(rotuloDoContato({ display_name: null, name: null, phone_number: null })).toBe(SEM_NOME);
    expect(rotuloDoContato({ display_name: "   ", name: "", phone_number: "" })).toBe(SEM_NOME);
    expect(rotuloDoContato(null)).toBe(SEM_NOME);
    expect(rotuloDoContato(undefined)).toBe(SEM_NOME);
  });

  it("não devolve identificador técnico NEM QUANDO é a única coisa que existe", () => {
    // A saída aqui é admitir que não se sabe o nome. Mostrar o `@lid` seria
    // vocabulário de máquina na tela de quem atende — a doença que a spec 16
    // mediu em 30% dos turnos.
    expect(rotuloDoContato({ display_name: "Contato 543134@lid", name: null, phone_number: null })).toBe(
      SEM_NOME,
    );
  });

  it("patchContactHandler sincroniza display_name quando name é atualizado no CRM", async () => {
    const { patchContactHandler } = await import("@/app/api/v1/contacts/_handler");
    let patchExecutado: Record<string, unknown> = {};
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "c-1",
                organization_id: "org-1",
                is_anonymized: false,
                name: null,
                display_name: "Wl",
                tags: [],
                consent: {},
              },
              error: null,
            }),
          }),
        }),
        update: (p: Record<string, unknown>) => {
          patchExecutado = p;
          return {
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: { id: "c05e7a00-0000-4000-8000-0000000000c1", ...p },
                  error: null,
                }),
              }),
            }),
          };
        },
      }),
      rpc: () => ({ then: (r: (v: unknown) => unknown) => r({ error: null }) }),
    };

    await patchContactHandler(
      fakeClient as never,
      {
        organization_id: "c05e7a00-0000-4000-8000-000000000001",
        actor: { type: "user", id: "c05e7a00-0000-4000-8000-0000000000a1" },
        requestId: "r-1",
      },
      "c05e7a00-0000-4000-8000-0000000000c1",
      { name: "Wesley Lopes" } as never,
    );

    expect(patchExecutado.name).toBe("Wesley Lopes");
    expect(patchExecutado.display_name).toBe("Wesley Lopes");
  });
});

describe("a sétima cópia não nasce", () => {
  it("nenhum arquivo remonta a cadeia de fallback à mão", () => {
    // A função central só resolve o problema enquanto for a ÚNICA. Seis cópias
    // não divergiram por descuido: cada tela nova reescreveu a cadeia do jeito
    // que parecia certo naquele arquivo, e nasceram quatro finais diferentes.
    const arquivos = execFileSync("git", ["ls-files", "app", "lib", "components"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => f !== "lib/contacts/rotulo-do-contato.ts");

    // `display_name` seguido de `||` na MESMA expressão: a assinatura da cadeia.
    const cadeia = /display_name\s*(\?\.\s*trim\(\)\s*)?\|\|/;
    const reincidentes: string[] = [];

    for (const f of arquivos) {
      const conteudo = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      // Fora as organizações: `organizations.display_name` é outro conceito e
      // tem cadeia própria e legítima.
      const linhas = conteudo.split("\n").filter((l) => cadeia.test(l) && !/org|tenant|session/i.test(l));
      if (linhas.length > 0) reincidentes.push(`${f}: ${linhas[0]!.trim().slice(0, 90)}`);
    }

    expect(reincidentes, `\n${reincidentes.join("\n")}\n`).toEqual([]);
  });

  it("a varredura ENXERGA arquivos — controle positivo", () => {
    const n = execFileSync("git", ["ls-files", "app", "lib", "components"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f)).length;
    expect(n).toBeGreaterThan(100);
  });
});
