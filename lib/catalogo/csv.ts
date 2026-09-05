import { precoParaCentavos } from "@/lib/schemas/produtos";

export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_DATA_ROWS = 1000;

const DELIMITERS = [",", ";", "\t"] as const;

export function parseCsv(raw: string): string[][] {
  const text = raw.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field.trim());
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field !== "" || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? "";
  let best: string = DELIMITERS[0];
  let bestCount = -1;
  for (const d of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export type ColunaProduto =
  | "codigo"
  | "nome"
  | "descricao"
  | "marca"
  | "categoria"
  | "preco"
  | "custo"
  | "controla_estoque"
  | "quantidade"
  | "ativo"
  | "imagem_url";

const ALIASES: Record<ColunaProduto, string[]> = {
  codigo: ["codigo", "código", "sku", "cod", "code", "id_produto"],
  nome: ["nome", "produto", "titulo", "título", "name", "title"],
  descricao: ["descricao", "descrição", "detalhes", "description"],
  marca: ["marca", "fabricante", "brand"],
  categoria: ["categoria", "secao", "seção", "departamento", "category"],
  preco: ["preco", "preço", "valor", "preco_venda", "preço_venda", "price"],
  custo: ["custo", "preco_custo", "preço_custo", "cost"],
  controla_estoque: ["controla_estoque", "controlar_estoque", "gerencia_estoque", "track_stock"],
  quantidade: ["quantidade", "estoque", "qtd", "stock", "quantity"],
  ativo: ["ativo", "status", "active", "habilitado"],
  imagem_url: ["imagem", "imagem_url", "foto", "url_imagem", "image", "image_url"],
};

export function normalizarCabecalho(coluna: string): string {
  return coluna
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function mapearColunas(header: string[]): Map<ColunaProduto, number> {
  const mapa = new Map<ColunaProduto, number>();
  for (let idx = 0; idx < header.length; idx += 1) {
    const limpo = normalizarCabecalho(header[idx] ?? "");
    for (const [coluna, aliases] of Object.entries(ALIASES) as [ColunaProduto, string[]][]) {
      if (aliases.some((a) => normalizarCabecalho(a) === limpo)) {
        if (!mapa.has(coluna)) mapa.set(coluna, idx);
      }
    }
  }
  return mapa;
}

function parseBoolean(val: string | undefined, defaultVal: boolean): boolean {
  if (!val || val.trim() === "") return defaultVal;
  const v = val.trim().toLowerCase();
  if (["sim", "s", "true", "1", "ativo", "yes", "y"].includes(v)) return true;
  if (["nao", "não", "n", "false", "0", "inativo", "no"].includes(v)) return false;
  return defaultVal;
}

export interface LinhaProdutoParseada {
  codigo: string;
  nome: string;
  descricao?: string;
  marca?: string;
  categoria?: string;
  preco_cents: number;
  custo_cents?: number;
  controla_estoque: boolean;
  quantidade: number;
  ativo: boolean;
  imagem_url?: string;
}

export interface ResultadoParseLinha {
  sucesso: boolean;
  dados?: LinhaProdutoParseada;
  erro?: string;
}

export function parseLinhaProduto(
  linha: string[],
  colunas: Map<ColunaProduto, number>,
): ResultadoParseLinha {
  const getCol = (col: ColunaProduto): string => {
    const idx = colunas.get(col);
    if (idx === undefined || idx >= linha.length) return "";
    return (linha[idx] ?? "").trim();
  };

  const codigo = getCol("codigo");
  if (!codigo) {
    return { sucesso: false, erro: "Código (SKU) é obrigatório." };
  }
  if (codigo.length > 60) {
    return { sucesso: false, erro: "Código (SKU) excede 60 caracteres." };
  }

  const nome = getCol("nome");
  if (!nome || nome.length < 2) {
    return { sucesso: false, erro: "Nome do produto deve ter pelo menos 2 caracteres." };
  }
  if (nome.length > 200) {
    return { sucesso: false, erro: "Nome do produto excede 200 caracteres." };
  }

  const precoRaw = getCol("preco");
  if (!precoRaw) {
    return { sucesso: false, erro: "Preço de venda é obrigatório." };
  }

  const precoCents = precoParaCentavos(precoRaw);
  if (precoCents === null || precoCents < 0) {
    return {
      sucesso: false,
      erro: `Preço '${precoRaw}' inválido ou contém texto misturado a números.`,
    };
  }

  let custoCents: number | undefined;
  const custoRaw = getCol("custo");
  if (custoRaw) {
    const c = precoParaCentavos(custoRaw);
    if (c === null || c < 0) {
      return {
        sucesso: false,
        erro: `Custo '${custoRaw}' inválido ou contém texto misturado a números.`,
      };
    }
    custoCents = c;
  }

  const controlaEstoque = parseBoolean(getCol("controla_estoque"), true);

  let quantidade = 0;
  const qtdRaw = getCol("quantidade");
  if (qtdRaw) {
    const q = parseInt(qtdRaw.replace(/[^\d-]/g, ""), 10);
    if (isNaN(q) || q < 0) {
      return { sucesso: false, erro: `Quantidade de estoque '${qtdRaw}' inválida.` };
    }
    quantidade = q;
  }

  const ativo = parseBoolean(getCol("ativo"), true);
  const descricao = getCol("descricao") || undefined;
  const marca = getCol("marca") || undefined;
  const categoria = getCol("categoria") || undefined;
  const imagemUrl = getCol("imagem_url") || undefined;

  return {
    sucesso: true,
    dados: {
      codigo,
      nome,
      descricao,
      marca,
      categoria,
      preco_cents: precoCents,
      custo_cents: custoCents,
      controla_estoque: controlaEstoque,
      quantidade,
      ativo,
      imagem_url: imagemUrl,
    },
  };
}

export function gerarModeloCsv(): string {
  const cabecalho = "codigo;nome;descricao;marca;categoria;preco;custo;controla_estoque;quantidade;ativo;imagem_url";
  const linhasExemplo = [
    'IP15-128;Apple iPhone 15 128GB Preto;Tela 6.1 Super Retina XDR;Apple;Smartphones;5499,00;4200,00;sim;15;sim;https://exemplo.com/ip15.jpg',
    'FONE-BT-JBL;Fone Bluetooth JBL Tune 520BT;Fone sem fio com bateria 57h;JBL;Áudio;299,90;180,00;sim;30;sim;',
    'SERV-GARANTIA;Garantia Estendida 12 Meses;Cobertura total contra defeitos;Loja;Serviços;199,00;;nao;0;sim;',
  ];
  return [cabecalho, ...linhasExemplo].join("\r\n");
}
