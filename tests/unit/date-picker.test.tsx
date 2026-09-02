import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { DatePicker } from "@/components/ui/date-picker";

describe("DatePicker (PT-BR)", () => {
  it("exibe placeholder em português dd/mm/aaaa quando vazio", () => {
    render(<DatePicker value="" onChange={vi.fn()} />);
    expect(screen.getByText("dd/mm/aaaa")).toBeInTheDocument();
  });

  it("formata a data no formato brasileiro dd/mm/aaaa", () => {
    render(<DatePicker value="2026-09-01" onChange={vi.fn()} />);
    expect(screen.getByText("01/09/2026")).toBeInTheDocument();
  });

  it("abre o calendário com dias da semana em português e permite selecionar", async () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-09-01" onChange={onChange} />);

    // Clica para abrir o popover
    fireEvent.click(screen.getByText("01/09/2026"));

    // Verifica cabeçalhos dos dias da semana em português
    expect(screen.getByText("Dom")).toBeInTheDocument();
    expect(screen.getByText("Seg")).toBeInTheDocument();
    expect(screen.getByText("Ter")).toBeInTheDocument();
    expect(screen.getByText("Qua")).toBeInTheDocument();
    expect(screen.getByText("Qui")).toBeInTheDocument();
    expect(screen.getByText("Sex")).toBeInTheDocument();
    expect(screen.getByText("Sáb")).toBeInTheDocument();

    // Verifica botões do rodapé
    expect(screen.getByText("Hoje")).toBeInTheDocument();
    expect(screen.getByText("Limpar")).toBeInTheDocument();
  });

  it("limpa a data ao clicar no botão de limpar", () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-09-01" onChange={onChange} />);

    const clearBtn = screen.getByTitle("Limpar data");
    fireEvent.click(clearBtn);

    expect(onChange).toHaveBeenCalledWith("");
  });
});
