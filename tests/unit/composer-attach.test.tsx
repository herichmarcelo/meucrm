import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadResult = {
  storage_path: "org/conv/out-1.jpg",
  media_mime: "image/jpeg",
  media_size_bytes: 3,
  kind: "image" as const,
};
const uploadMock = vi.fn(async () => uploadResult);
const sendMock = vi.fn();

vi.mock("@/hooks/inbox/useUploadMedia", () => ({
  useUploadMedia: () => ({ mutateAsync: uploadMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useSendMessage", () => ({
  useSendMessage: () => ({ mutate: sendMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useCatalogSearch", () => ({
  useCatalogSearch: () => ({
    data: [
      {
        id: "p1",
        codigo: "IP15",
        nome: "Apple iPhone 15 128GB Preto",
        marca: "Apple",
        categoria: "Smartphones",
        preco_cents: 499900,
        preco_formatado: "R$ 4.999,00",
        moeda: "BRL",
        controla_estoque: true,
        quantidade: 5,
        disponivel: true,
        imagem_url: "https://example.com/ip15.jpg",
      },
      {
        id: "p2",
        codigo: "FONE-BT",
        nome: "Fone Bluetooth JBL Tune",
        marca: "JBL",
        categoria: "Audio",
        preco_cents: 29900,
        preco_formatado: "R$ 299,00",
        moeda: "BRL",
        controla_estoque: false,
        quantidade: 0,
        disponivel: true,
        imagem_url: null,
      },
    ],
    isLoading: false,
  }),
}));

import { Composer } from "@/components/inbox/Composer";

function renderComposer() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <Composer conversationId="conv-1" />
    </QueryClientProvider>,
  );
}

describe("Composer + anexos", () => {
  beforeEach(() => {
    uploadMock.mockClear();
    sendMock.mockClear();
  });

  it("botão Anexar abre o menu com Fotos e vídeos, Documento e Catálogo", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
    expect(screen.getByText("Fotos e vídeos")).toBeInTheDocument();
    expect(screen.getByText("Documento")).toBeInTheDocument();
    expect(screen.getByText("Catálogo")).toBeInTheDocument();
  });

  it("selecionar arquivo abre preview e enviar dispara upload + send com caption", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
    const input = document.querySelector('input[accept^="image"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/legenda/i), { target: { value: "olha isso" } });
    fireEvent.click(screen.getByRole("button", { name: /^enviar$/i }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: "conv-1",
          type: "image",
          body: "olha isso",
          media_storage_path: "org/conv/out-1.jpg",
          media_mime: "image/jpeg",
          media_size_bytes: 3,
        }),
        expect.anything(),
      ),
    );
  });

  it("upload falho mantém o dialog aberto (sem disparar send)", async () => {
    uploadMock.mockRejectedValueOnce(new Error("upload_failed"));
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
    const input = document.querySelector('input[accept^="image"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^enviar$/i }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("clicar em Catálogo abre o modal de catálogo e enviar produto com imagem envia foto com legenda", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
    fireEvent.click(screen.getByText("Catálogo"));

    expect(await screen.findByText("Catálogo de produtos")).toBeInTheDocument();
    expect(screen.getByText("Apple iPhone 15 128GB Preto")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Apple iPhone 15 128GB Preto"));

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "conv-1",
        type: "image",
        media_url: "https://example.com/ip15.jpg",
        body: "*Apple iPhone 15 128GB Preto*\nR$ 4.999,00",
      }),
      expect.anything(),
    );
  });

  it("enviar produto sem imagem envia como texto simples", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
    fireEvent.click(screen.getByText("Catálogo"));

    expect(await screen.findByText("Fone Bluetooth JBL Tune")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Fone Bluetooth JBL Tune"));

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "conv-1",
        type: "text",
        body: "*Fone Bluetooth JBL Tune*\nR$ 299,00",
      }),
      expect.anything(),
    );
  });
});
