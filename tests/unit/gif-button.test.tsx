import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { GifPicker } from "@/components/inbox/composer/GifPicker";

describe("GifPicker Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renderiza campo de busca, tags rápidas e rodapé GIPHY", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: [
          {
            id: "1",
            title: "Celebration",
            preview_url: "https://media.giphy.com/preview.webp",
            url: "https://media.giphy.com/full.gif",
            width: 200,
            height: 200,
          },
        ],
      }),
    });

    render(<GifPicker onPick={vi.fn()} />);

    expect(screen.getByPlaceholderText("Buscar GIFs no GIPHY...")).toBeInTheDocument();
    expect(screen.getByText("Em Alta")).toBeInTheDocument();
    expect(screen.getByText("Haha")).toBeInTheDocument();
    expect(screen.getByText("GIPHY")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByAltText("Celebration")).toBeInTheDocument();
    });
  });

  it("chama onPick com o GIF selecionado ao clicar", async () => {
    const onPick = vi.fn();
    const gifItem = {
      id: "1",
      title: "Happy Dance",
      preview_url: "https://media.giphy.com/dance_preview.webp",
      url: "https://media.giphy.com/dance.gif",
      width: 200,
      height: 200,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: [gifItem],
      }),
    });

    render(<GifPicker onPick={onPick} />);

    await waitFor(() => {
      expect(screen.getByAltText("Happy Dance")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByAltText("Happy Dance"));
    expect(onPick).toHaveBeenCalledWith(gifItem);
  });
});
