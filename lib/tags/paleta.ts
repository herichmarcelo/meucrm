/**
 * Paleta fixa e curada de cores para tags no meucrm.
 * 
 * Regras de design:
 * - A cor pertence à definição da tag (org-scoped), não à instância.
 * - Paleta fixa com 9 cores nomeadas com contraste testado em tema claro e escuro (WCAG AA).
 * - Fallback neutro automático quando tag não tem cor definida ou tem cor nula.
 */

export interface TagColorDef {
  id: string;
  label: string;
  /** Classe da bolinha no seletor e indicador */
  dotClass: string;
  /** Classes completas de badge (fundo, texto, borda) para light e dark mode */
  badgeClass: string;
  /** Cor de destaque (hex aproximado para casos especiais/bordas) */
  hex: string;
}

export const PALETA_CORES_TAGS: readonly TagColorDef[] = [
  {
    id: "vermelho",
    label: "Vermelho",
    dotClass: "bg-red-500",
    badgeClass: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800",
    hex: "#ef4444",
  },
  {
    id: "laranja",
    label: "Laranja",
    dotClass: "bg-orange-500",
    badgeClass: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800",
    hex: "#f97316",
  },
  {
    id: "amarelo",
    label: "Amarelo",
    dotClass: "bg-amber-500",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
    hex: "#f59e0b",
  },
  {
    id: "verde",
    label: "Verde",
    dotClass: "bg-emerald-500",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
    hex: "#10b981",
  },
  {
    id: "azul",
    label: "Azul",
    dotClass: "bg-blue-500",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800",
    hex: "#3b82f6",
  },
  {
    id: "roxo",
    label: "Roxo",
    dotClass: "bg-purple-500",
    badgeClass: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800",
    hex: "#a855f7",
  },
  {
    id: "rosa",
    label: "Rosa",
    dotClass: "bg-pink-500",
    badgeClass: "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/60 dark:text-pink-300 dark:border-pink-800",
    hex: "#ec4899",
  },
  {
    id: "ciano",
    label: "Ciano",
    dotClass: "bg-cyan-500",
    badgeClass: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800",
    hex: "#06b6d4",
  },
  {
    id: "cinza",
    label: "Cinza",
    dotClass: "bg-zinc-500",
    badgeClass: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
    hex: "#71717a",
  },
] as const;

/** Estilo neutro idêntico ao Badge variant="secondary" do shadcn/ui */
export const TAG_COR_NEUTRA: TagColorDef = {
  id: "neutro",
  label: "Neutro",
  dotClass: "bg-muted-foreground/50",
  badgeClass: "bg-secondary text-secondary-foreground border-transparent",
  hex: "#94a3b8",
};

/** Mapeia aliases em inglês e português para o identificador canônico */
const ALIASES: Record<string, string> = {
  red: "vermelho",
  orange: "laranja",
  yellow: "amarelo",
  amber: "amarelo",
  green: "verde",
  emerald: "verde",
  blue: "azul",
  purple: "roxo",
  violet: "roxo",
  pink: "rosa",
  cyan: "ciano",
  teal: "ciano",
  gray: "cinza",
  grey: "cinza",
  zinc: "cinza",
};

const MAPA_CORES = new Map<string, TagColorDef>(
  PALETA_CORES_TAGS.map((c) => [c.id, c]),
);

/**
 * Obtém a definição de estilo de uma cor de tag.
 * Se a cor for nula, indefinida ou desconhecida, retorna o estilo neutro (fallback seguro).
 */
export function obterEstiloTag(cor: string | null | undefined): TagColorDef {
  if (!cor) return TAG_COR_NEUTRA;
  const normalizada = cor.trim().toLowerCase();
  const canonicalId = ALIASES[normalizada] ?? normalizada;
  return MAPA_CORES.get(canonicalId) ?? TAG_COR_NEUTRA;
}
