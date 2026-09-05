import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MediaRenderer } from "@/components/inbox/media/MediaRenderer";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { isGifPlayback, type Message } from "@/lib/types/messaging";
import { previewFrom } from "@/app/api/v1/messages/_handler";

function msg(over: Partial<Message>): Message {
  return {
    id: "m1",
    conversation_id: "c1",
    contact_id: "ct1",
    channel_session_id: "s1",
    external_id: "x1",
    type: "text",
    direction: "inbound",
    status: "delivered",
    ack: null,
    body: null,
    media_url: "http://waha/file",
    media_mime: null,
    media_size_bytes: null,
    media_storage_path: null,
    sent_via: "external_device",
    sent_at: "2026-07-21T20:00:00.000Z",
    delivered_at: null,
    read_at: null,
    error_code: null,
    error_message: null,
    metadata: {},
    created_at: "2026-07-21T20:00:00.000Z",
    ...over,
  } as Message;
}

describe("MediaRenderer", () => {
  it("image → ImageMedia", () => {
    render(<MediaRenderer message={msg({ type: "image" })} />);
    expect(screen.getByAltText("Imagem recebida")).toBeInTheDocument();
  });
  it("sticker → StickerMedia", () => {
    render(<MediaRenderer message={msg({ type: "sticker" })} />);
    expect(screen.getByAltText("Figurinha")).toBeInTheDocument();
  });
  it("audio → AudioPlayer", () => {
    render(<MediaRenderer message={msg({ type: "audio" })} />);
    expect(screen.getByRole("button", { name: /reproduzir/i })).toBeInTheDocument();
  });
  it("video → VideoMedia normal (com controls, sem autoplay/loop)", () => {
    const { container } = render(<MediaRenderer message={msg({ type: "video" })} />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).not.toHaveAttribute("loop");
  });
  it("video com gif_playback: true → VideoMedia em loop sem controls", () => {
    const { container } = render(
      <MediaRenderer message={msg({ type: "video", metadata: { gif_playback: true } })} />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).not.toHaveAttribute("controls");
    expect(video).toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("loop");
    expect((video as HTMLVideoElement).muted || video?.hasAttribute("muted")).toBeTruthy();
    expect(video).toHaveAttribute("playsinline");
  });
  it("document (e tipos desconhecidos) → DocumentCard", () => {
    render(<MediaRenderer message={msg({ type: "document", media_mime: "application/pdf" })} />);
    expect(screen.getByRole("link", { name: /baixar pdf/i })).toBeInTheDocument();
  });
});

describe("isGifPlayback & previewFrom", () => {
  it("detecta flag gif_playback booleana ou string", () => {
    expect(isGifPlayback({ gif_playback: true })).toBe(true);
    expect(isGifPlayback({ gif_playback: "true" })).toBe(true);
    expect(isGifPlayback({ gif_playback: false })).toBe(false);
    expect(isGifPlayback({})).toBe(false);
    expect(isGifPlayback(null)).toBe(false);
    expect(isGifPlayback(undefined)).toBe(false);
  });

  it("previewFrom gera 'GIF' quando gif_playback é true e '[video]' quando ausente/falso", () => {
    expect(
      previewFrom({
        type: "video",
        media_url: "https://giphy.com/anim.mp4",
        metadata: { gif_playback: true },
      }),
    ).toBe("GIF");

    expect(
      previewFrom({
        type: "video",
        media_url: "https://example.com/video.mp4",
        metadata: {},
      }),
    ).toBe("[video]");
  });
});

describe("MessageBubble com mídia", () => {
  it("renderiza mídia E caption juntos", () => {
    render(<MessageBubble message={msg({ type: "image", body: "olha isso" })} />);
    expect(screen.getByAltText("Imagem recebida")).toBeInTheDocument();
    expect(screen.getByText("olha isso")).toBeInTheDocument();
  });
  it("mensagem só-texto não renderiza mídia", () => {
    render(<MessageBubble message={msg({ type: "text", body: "oi", media_url: null })} />);
    expect(screen.queryByAltText("Imagem recebida")).not.toBeInTheDocument();
  });
});
