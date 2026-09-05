import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();
const createNoteMock = vi.fn();

vi.mock("@/hooks/inbox/useSendMessage", () => ({
  useSendMessage: () => ({ mutate: sendMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useCreateNote", () => ({
  useCreateNote: () => ({ mutate: createNoteMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useUploadMedia", () => ({
  useUploadMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useMessageTemplates", () => ({
  useMessageTemplates: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/inbox/useDraftReply", () => ({
  useDraftReply: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/i18n/useT", () => ({
  useT: () => (s: string) => s,
}));

import { Composer } from "@/components/inbox/Composer";

function renderComposer(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <Composer conversationId="conv-email-1" {...props} />
    </QueryClientProvider>,
  );
}

describe("Composer — Modo Canal de E-mail", () => {
  beforeEach(() => {
    sendMock.mockClear();
    createNoteMock.mockClear();
  });

  it("renderiza campo de assunto e placeholder de e-mail quando channel='email'", () => {
    renderComposer({ channel: "email" });

    expect(screen.getByLabelText("Assunto do e-mail")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Escreva uma resposta por e-mail…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /gravar áudio/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^enviar$/i })).toBeInTheDocument();
  });

  it("renderiza campo de assunto quando channelProvider='email'", () => {
    renderComposer({ channelProvider: "email" });

    expect(screen.getByLabelText("Assunto do e-mail")).toBeInTheDocument();
  });

  it("envia mensagem com metadata.subject quando assunto é preenchido", () => {
    renderComposer({ channel: "email" });

    fireEvent.change(screen.getByLabelText("Assunto do e-mail"), {
      target: { value: "Proposta Comercial #402" },
    });
    fireEvent.change(screen.getByLabelText("Mensagem"), {
      target: { value: "Segue em anexo os detalhes." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^enviar$/i }));

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "conv-email-1",
        body: "Segue em anexo os detalhes.",
        type: "text",
        metadata: { subject: "Proposta Comercial #402" },
      }),
      expect.anything(),
    );
  });

  it("limpa input de texto e assunto após envio", () => {
    renderComposer({ channel: "email" });

    const subjectInput = screen.getByLabelText("Assunto do e-mail");
    const bodyInput = screen.getByLabelText("Mensagem");

    fireEvent.change(subjectInput, { target: { value: "Assunto Teste" } });
    fireEvent.change(bodyInput, { target: { value: "Corpo do e-mail" } });
    fireEvent.click(screen.getByRole("button", { name: /^enviar$/i }));

    expect(subjectInput).toHaveValue("");
    expect(bodyInput).toHaveValue("");
  });

  it("exibe placeholder com 'Re: ...' no assunto quando está respondendo uma mensagem", () => {
    renderComposer({
      channel: "email",
      respondendo: {
        id: "msg-1",
        body: "Orçamento de consultoria técnica",
        direction: "inbound",
      },
    });

    const subjectInput = screen.getByLabelText("Assunto do e-mail");
    expect(subjectInput).toHaveAttribute("placeholder", "Re: Orçamento de consultoria técnica…");
  });
});
