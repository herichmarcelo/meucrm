import { describe, expect, it } from "vitest";
import {
  mapearColunas,
  parseCsv,
  parseLinhaProduto,
} from "@/lib/catalogo/csv";
import { GET as templateHandler } from "@/app/api/v1/products/template/route";

describe("Importação de CSV de Produtos", () => {
  it("detecta delimitadores comuns e preserva aspas", () => {
    const csv = 'codigo;nome;preco\n"IP15";"Apple iPhone 15; 128GB";"5.499,00"';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["codigo", "nome", "preco"]);
    expect(rows[1]).toEqual(["IP15", "Apple iPhone 15; 128GB", "5.499,00"]);
  });

  it("mapeia sinônimos de cabeçalho (SKU, Produto, Valor, Estoque)", () => {
    const header = ["SKU", "Produto", "Marca", "Valor", "Qtd", "Status"];
    const mapa = mapearColunas(header);
    expect(mapa.get("codigo")).toBe(0);
    expect(mapa.get("nome")).toBe(1);
    expect(mapa.get("marca")).toBe(2);
    expect(mapa.get("preco")).toBe(3);
    expect(mapa.get("quantidade")).toBe(4);
    expect(mapa.get("ativo")).toBe(5);
  });

  it("converte linha válida para centavos inteiros e booleans", () => {
    const header = ["codigo", "nome", "preco", "custo", "controla_estoque", "quantidade", "ativo"];
    const mapa = mapearColunas(header);
    const linha = ["PROD-1", "Teclado Mecânico RGB", "299,90", "150,00", "sim", "20", "ativo"];

    const res = parseLinhaProduto(linha, mapa);
    expect(res.sucesso).toBe(true);
    expect(res.dados).toEqual({
      codigo: "PROD-1",
      nome: "Teclado Mecânico RGB",
      descricao: undefined,
      marca: undefined,
      categoria: undefined,
      preco_cents: 29990,
      custo_cents: 15000,
      controla_estoque: true,
      quantidade: 20,
      ativo: true,
      imagem_url: undefined,
    });
  });

  it("rejeita linha com preço contendo texto colado a números", () => {
    const header = ["codigo", "nome", "preco"];
    const mapa = mapearColunas(header);
    const linha = ["PROD-2", "Notebook Gamer", "5.499,00 (promo até 10)"];

    const res = parseLinhaProduto(linha, mapa);
    expect(res.sucesso).toBe(false);
    expect(res.erro).toContain("inválido ou contém texto misturado a números");
  });

  it("gera modelo de CSV no endpoint template", async () => {
    const res = await templateHandler();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const body = await res.text();
    expect(body).toContain("codigo;nome;descricao;marca;categoria;preco;custo");
  });
});
