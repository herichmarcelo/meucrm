/**
 * A regra que decide tudo: PALAVRA é difusa, NÚMERO é exato.
 * Um número que o cliente disse e que o produto não tem ELIMINA o produto
 * (não rebaixa) — é o que impede "256GB" de trazer o produto de "128GB".
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const RUIDO = new Set(["de", "do", "da", "com", "para", "por", "the", "e", "o", "a", "um", "uma"]);

export interface TokensDaBusca {
  palavras: string[];
  numeros: string[];
}

export function tokenizar(consulta: string): TokensDaBusca {
  const palavras: string[] = [];
  const numeros: string[] = [];
  for (const t of normalizar(consulta).split(" ")) {
    if (t === "" || RUIDO.has(t)) continue;
    const comUnidade = /^(\d+)([a-z]{1,4})?$/.exec(t);
    if (comUnidade?.[1] !== undefined) numeros.push(comUnidade[1]);
    else palavras.push(t);
  }
  return { palavras, numeros };
}

function temONumero(alvoNormalizado: string, numero: string): boolean {
  return new RegExp(`(^|\\s)${numero}([a-z]{1,4})?($|\\s)`).test(alvoNormalizado);
}

export interface ProdutoBuscavel {
  nome: string;
  codigo: string;
  marca?: string | null;
  categoria?: string | null;
}

export function pontuar(produto: ProdutoBuscavel, tokens: TokensDaBusca): number | null {
  const alvo = normalizar(
    [produto.nome, produto.marca ?? "", produto.categoria ?? "", produto.codigo].join(" "),
  );
  for (const n of tokens.numeros) {
    if (!temONumero(alvo, n)) return null;
  }
  if (tokens.palavras.length === 0) {
    return tokens.numeros.length > 0 ? 1 : null;
  }
  const doAlvo = alvo.split(" ");
  let soma = 0;
  for (const p of tokens.palavras) {
    let melhor = 0;
    for (const t of doAlvo) {
      const mesmaInicial = t[0] === p[0];
      let nota = 0;
      if (t === p) nota = 1;
      else if (t.startsWith(p) || p.startsWith(t)) nota = 0.9;
      else if (p.length >= 4 && distanciaAte(p, t, 1)) nota = mesmaInicial ? 0.75 : 0.5;
      else if (p.length >= 5 && distanciaAte(p, t, 2)) nota = mesmaInicial ? 0.6 : 0;
      if (nota > melhor) melhor = nota;
    }
    soma += melhor;
  }
  if (soma === 0) return null;
  return soma / tokens.palavras.length;
}

function distanciaAte(a: string, b: string, teto: number): boolean {
  if (Math.abs(a.length - b.length) > teto) return false;
  const anterior: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    let menorNaLinha = i;
    for (let j = 1; j <= b.length; j += 1) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(
        (atual[j - 1] ?? 0) + 1,
        (anterior[j] ?? 0) + 1,
        (anterior[j - 1] ?? 0) + custo,
      );
      atual.push(v);
      if (v < menorNaLinha) menorNaLinha = v;
    }
    if (menorNaLinha > teto) return false;
    for (let k = 0; k <= b.length; k += 1) anterior[k] = atual[k] ?? 0;
  }
  return (anterior[b.length] ?? teto + 1) <= teto;
}

export interface Achado<T> {
  produto: T;
  nota: number;
}

export function ordenarPorRelevancia<T extends ProdutoBuscavel>(
  produtos: readonly T[],
  consulta: string,
): Achado<T>[] {
  const tokens = tokenizar(consulta);
  if (tokens.palavras.length === 0 && tokens.numeros.length === 0) return [];
  const achados: Achado<T>[] = [];
  for (const produto of produtos) {
    const nota = pontuar(produto, tokens);
    if (nota !== null) achados.push({ produto, nota });
  }
  return achados.sort((a, b) => b.nota - a.nota || a.produto.nome.localeCompare(b.produto.nome));
}
