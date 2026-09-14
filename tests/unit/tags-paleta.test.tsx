import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import {
  obterEstiloTag,
  PALETA_CORES_TAGS,
  TAG_COR_NEUTRA,
} from "@/lib/tags/paleta";
import { TagChip } from "@/components/tags/TagChip";

describe("lib/tags/paleta - Paleta de cores de tags", () => {
  it("retorna estilo neutro para tag sem cor (null, undefined ou vazia)", () => {
    expect(obterEstiloTag(null)).toEqual(TAG_COR_NEUTRA);
    expect(obterEstiloTag(undefined)).toEqual(TAG_COR_NEUTRA);
    expect(obterEstiloTag("")).toEqual(TAG_COR_NEUTRA);
    expect(obterEstiloTag("   ")).toEqual(TAG_COR_NEUTRA);
  });

  it("retorna estilo neutro para cor desconhecida sem quebrar a UI", () => {
    expect(obterEstiloTag("cor_inexistente_xyz")).toEqual(TAG_COR_NEUTRA);
  });

  it("mapeia corretamente as cores em português e seus aliases em inglês", () => {
    const vermelho = obterEstiloTag("vermelho");
    expect(vermelho.id).toBe("vermelho");
    expect(vermelho.badgeClass).toContain("bg-red-50");
    expect(vermelho.badgeClass).toContain("dark:bg-red-950/60");

    // Aliases e normalização (case-insensitive e trim)
    expect(obterEstiloTag("red").id).toBe("vermelho");
    expect(obterEstiloTag("  RED  ").id).toBe("vermelho");

    expect(obterEstiloTag("azul").id).toBe("azul");
    expect(obterEstiloTag("blue").id).toBe("azul");

    expect(obterEstiloTag("verde").id).toBe("verde");
    expect(obterEstiloTag("green").id).toBe("verde");

    expect(obterEstiloTag("amarelo").id).toBe("amarelo");
    expect(obterEstiloTag("yellow").id).toBe("amarelo");

    expect(obterEstiloTag("laranja").id).toBe("laranja");
    expect(obterEstiloTag("orange").id).toBe("laranja");

    expect(obterEstiloTag("roxo").id).toBe("roxo");
    expect(obterEstiloTag("purple").id).toBe("roxo");

    expect(obterEstiloTag("rosa").id).toBe("rosa");
    expect(obterEstiloTag("pink").id).toBe("rosa");

    expect(obterEstiloTag("ciano").id).toBe("ciano");
    expect(obterEstiloTag("cyan").id).toBe("ciano");

    expect(obterEstiloTag("cinza").id).toBe("cinza");
    expect(obterEstiloTag("gray").id).toBe("cinza");
  });

  it("garante que todas as cores da paleta suportam tema claro e escuro", () => {
    expect(PALETA_CORES_TAGS.length).toBeGreaterThanOrEqual(8);
    for (const cor of PALETA_CORES_TAGS) {
      expect(cor.badgeClass).toContain("dark:");
      expect(cor.dotClass).toBeDefined();
      expect(cor.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("components/tags/TagChip - Renderização visual", () => {
  it("renderiza tag com cor definida e classes correspondentes", () => {
    render(<TagChip tag="urgente" color="vermelho" />);
    const chip = screen.getByText("urgente").closest("div");
    expect(chip).toBeInTheDocument();
    expect(chip?.className).toContain("bg-red-50");
  });

  it("renderiza tag sem cor recaindo no estilo neutro sem quebrar", () => {
    render(<TagChip tag="dúvida" color={null} />);
    const chip = screen.getByText("dúvida").closest("div");
    expect(chip).toBeInTheDocument();
    expect(chip?.className).toContain("bg-secondary");
  });

  it("dispara callback onRemove ao clicar no botão de remoção", () => {
    const handleRemove = vi.fn();
    render(<TagChip tag="orçamento" color="azul" onRemove={handleRemove} size="md" />);

    const removeBtn = screen.getByRole("button", { name: "Remover tag orçamento" });
    fireEvent.click(removeBtn);
    expect(handleRemove).toHaveBeenCalledTimes(1);
  });
});
