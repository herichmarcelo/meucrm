import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { CatalogPickerDialog } from "@/components/inbox/composer/CatalogPickerDialog";
import type { CatalogSearchItem } from "@/app/api/v1/catalog/search/route";

const mockProducts: CatalogSearchItem[] = [
  {
    id: "prod-1",
    codigo: "IP15-128",
    nome: "Apple iPhone 15 128GB Preto",
    descricao: "Smartphone Apple",
    marca: "Apple",
    categoria: "Smartphones",
    preco_cents: 499900,
    preco_formatado: "R$ 4.999,00",
    moeda: "BRL",
    controla_estoque: true,
    quantidade: 5,
    disponivel: true,
    imagem_url: "https://example.com/img.jpg",
  },
  {
    id: "prod-2",
    codigo: "IP15-256",
    nome: "Apple iPhone 15 256GB Azul",
    descricao: "Smartphone Apple 256",
    marca: "Apple",
    categoria: "Smartphones",
    preco_cents: 579900,
    preco_formatado: "R$ 5.799,00",
    moeda: "BRL",
    controla_estoque: true,
    quantidade: 0,
    disponivel: false,
    imagem_url: null,
  },
];

let currentSearchTerm = "";
let currentResults: CatalogSearchItem[] = mockProducts;
let isLoadingMock = false;

vi.mock("@/hooks/inbox/useCatalogSearch", () => ({
  useCatalogSearch: (termo: string) => {
    currentSearchTerm = termo;
    return {
      data: currentResults,
      isLoading: isLoadingMock,
    };
  },
}));

describe("CatalogPickerDialog", () => {
  const onOpenChange = vi.fn();
  const onPick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchTerm = "";
    currentResults = mockProducts;
    isLoadingMock = false;
  });

  it("renderiza lista de produtos com nome, preço formatado e miniatura", () => {
    render(
      <CatalogPickerDialog
        open={true}
        onOpenChange={onOpenChange}
        onPick={onPick}
      />,
    );

    expect(screen.getByText("Catálogo de produtos")).toBeInTheDocument();
    expect(screen.getByText("Apple iPhone 15 128GB Preto")).toBeInTheDocument();
    expect(screen.getByText("R$ 4.999,00")).toBeInTheDocument();
    expect(screen.getByText("Apple iPhone 15 256GB Azul")).toBeInTheDocument();
    expect(screen.getByText("R$ 5.799,00")).toBeInTheDocument();
  });

  it("exibe badge 'Sem estoque' quando produto não está disponível, mas permite seleção", () => {
    render(
      <CatalogPickerDialog
        open={true}
        onOpenChange={onOpenChange}
        onPick={onPick}
      />,
    );

    expect(screen.getByText("Sem estoque")).toBeInTheDocument();

    // Clicar no produto sem estoque deve chamar onPick normalmente
    fireEvent.click(screen.getByText("Apple iPhone 15 256GB Azul"));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(mockProducts[1]);
  });

  it("selecionar um produto disponível chama onPick com o produto", () => {
    render(
      <CatalogPickerDialog
        open={true}
        onOpenChange={onOpenChange}
        onPick={onPick}
      />,
    );

    fireEvent.click(screen.getByText("Apple iPhone 15 128GB Preto"));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(mockProducts[0]);
  });

  it("exibe estado de busca vazia quando não há produtos", () => {
    currentResults = [];
    render(
      <CatalogPickerDialog
        open={true}
        onOpenChange={onOpenChange}
        onPick={onPick}
      />,
    );

    expect(
      screen.getByText("Nenhum produto cadastrado no catálogo."),
    ).toBeInTheDocument();
  });

  it("campo de busca debounced aciona termo de busca", async () => {
    render(
      <CatalogPickerDialog
        open={true}
        onOpenChange={onOpenChange}
        onPick={onPick}
      />,
    );

    const input = screen.getByPlaceholderText(/buscar por nome/i);
    fireEvent.change(input, { target: { value: "iphone 15" } });

    await waitFor(
      () => {
        expect(currentSearchTerm).toBe("iphone 15");
      },
      { timeout: 1000 },
    );
  });
});
