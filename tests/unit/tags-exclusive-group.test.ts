import { describe, expect, it, vi } from "vitest";
import { resolverTagsExclusivas } from "@/lib/tags/exclusive-group";
import type { SupabaseClient } from "@supabase/supabase-js";

const ORG = "22222222-2222-4222-8222-222222222222";

function createMockSupabase(exclusiveTags: Array<{ name: string; group_slug: string }>) {
  const mockSelect = vi.fn().mockReturnThis();
  const mockNot = vi.fn().mockResolvedValue({
    data: exclusiveTags.map((t) => ({ ...t, is_exclusive: true })),
    error: null,
  });

  return {
    from: vi.fn().mockReturnValue({
      select: mockSelect,
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          not: mockNot,
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("lib/tags/exclusive-group — resolverTagsExclusivas", () => {
  it("preserva tags livres sem alteração", async () => {
    const supabase = createMockSupabase([
      { name: "suporte", group_slug: "tipo_atendimento" },
      { name: "vendas", group_slug: "tipo_atendimento" },
    ]);

    const result = await resolverTagsExclusivas(["urgente", "vip"], ORG, supabase);
    expect(result).toEqual(["urgente", "vip"]);
  });

  it("permite uma tag de grupo exclusivo", async () => {
    const supabase = createMockSupabase([
      { name: "suporte", group_slug: "tipo_atendimento" },
      { name: "vendas", group_slug: "tipo_atendimento" },
    ]);

    const result = await resolverTagsExclusivas(["urgente", "suporte"], ORG, supabase);
    expect(result).toEqual(["urgente", "suporte"]);
  });

  it("mantém apenas a última tag quando duas do mesmo grupo exclusivo são passadas", async () => {
    const supabase = createMockSupabase([
      { name: "suporte", group_slug: "tipo_atendimento" },
      { name: "vendas", group_slug: "tipo_atendimento" },
    ]);

    // O usuário tinha 'suporte' e adicionou 'vendas' no final
    const result = await resolverTagsExclusivas(["urgente", "suporte", "vendas"], ORG, supabase);
    expect(result).toEqual(["urgente", "vendas"]);
  });

  it("respeita múltiplos grupos exclusivos independentes", async () => {
    const supabase = createMockSupabase([
      { name: "suporte", group_slug: "tipo_atendimento" },
      { name: "vendas", group_slug: "tipo_atendimento" },
      { name: "alta", group_slug: "prioridade" },
      { name: "baixa", group_slug: "prioridade" },
    ]);

    const result = await resolverTagsExclusivas(
      ["alta", "suporte", "baixa", "vendas", "lead_frio"],
      ORG,
      supabase,
    );
    // Para prioridade: 'alta' descartada, 'baixa' mantida
    // Para tipo_atendimento: 'suporte' descartado, 'vendas' mantido
    // Para livre: 'lead_frio' mantida
    expect(result).toEqual(["baixa", "vendas", "lead_frio"]);
  });
});
