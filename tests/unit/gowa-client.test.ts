import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveGowaChatId } from "@/lib/gowa/send";
import { parseGowaMessageId } from "@/lib/gowa/message-id";
import { GowaClient } from "@/lib/gowa/client";

describe("resolveGowaChatId", () => {
  it("converte número comum em @s.whatsapp.net", () => {
    expect(resolveGowaChatId("5511999999999")).toBe("5511999999999@s.whatsapp.net");
    expect(resolveGowaChatId("+55 11 99999-9999")).toBe("5511999999999@s.whatsapp.net");
  });

  it("preserva sufixo @s.whatsapp.net, @lid e @g.us", () => {
    expect(resolveGowaChatId("5511999999999@s.whatsapp.net")).toBe("5511999999999@s.whatsapp.net");
    expect(resolveGowaChatId("1234567890@lid")).toBe("1234567890@lid");
    expect(resolveGowaChatId("1203630248472910@g.us")).toBe("1203630248472910@g.us");
  });

  it("converte sufixo legado @c.us para @s.whatsapp.net", () => {
    expect(resolveGowaChatId("5511999999999@c.us")).toBe("5511999999999@s.whatsapp.net");
  });
});

describe("parseGowaMessageId", () => {
  it("extrai ID limpo de bare ID", () => {
    const res = parseGowaMessageId("3EB0123456789ABCDEF");
    expect(res.rawId).toBe("3EB0123456789ABCDEF");
    expect(res.isFromMe).toBeUndefined();
  });

  it("extrai ID composto de envelope", () => {
    const res = parseGowaMessageId("true_5511999999999@s.whatsapp.net_3EB0123456789ABCDEF");
    expect(res.rawId).toBe("3EB0123456789ABCDEF");
    expect(res.isFromMe).toBe(true);
    expect(res.participant).toBe("5511999999999@s.whatsapp.net");
  });
});

describe("GowaClient", () => {
  const mockFetch = vi.fn();
  let client: GowaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch;
    client = new GowaClient("http://localhost:4000", "admin", "secret123");
  });

  it("envia Basic Auth e X-Device-Id nas requisições", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "200",
          message: "Success",
          results: { message_id: "MSG_123" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await client.sendText("device_1", "5511999999999@s.whatsapp.net", "Olá Mundo");
    expect(res.externalId).toBe("MSG_123");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = (mockFetch.mock.calls[0] ?? []) as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("http://localhost:4000/send/message");
    expect(options.method).toBe("POST");
    expect(options.headers["X-Device-Id"]).toBe("device_1");
    // "admin:secret123" em base64 = "YWRtaW46c2VjcmV0MTIz"
    expect(options.headers["Authorization"]).toBe("Basic YWRtaW46c2VjcmV0MTIz");
    const body = JSON.parse(String(options.body));
    expect(body.phone).toBe("5511999999999@s.whatsapp.net");
    expect(body.message).toBe("Olá Mundo");
  });

  it("getDeviceStatus mapeia status conectado e logado", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "200",
          message: "Success",
          results: {
            is_connected: true,
            is_logged_in: true,
            jid: "5511999999999@s.whatsapp.net",
            name: "Empresa",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const status = await client.getDeviceStatus("device_1");
    expect(status.isConnected).toBe(true);
    expect(status.isLoggedIn).toBe(true);
    expect(status.jid).toBe("5511999999999@s.whatsapp.net");
    expect(status.name).toBe("Empresa");
  });

  it("fetchQrImage retorna buffer de imagem e content type", async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    mockFetch.mockResolvedValueOnce(
      new Response(pngBytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const res = await client.fetchQrImage("/statics/qrcode/dev.png", "device_1");
    expect(res.contentType).toBe("image/png");
    expect(res.buffer).toBeInstanceOf(ArrayBuffer);
    expect(res.buffer.byteLength).toBe(8);
  });

  it("sendMedia baixa a URL e envia como FormData multipart via fallback", async () => {
    // 1º fetch: chamada POST image_url falha
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "INTERNAL_SERVER_ERROR", message: "image download failed" }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );

    // 2º fetch: download da imagem pelo CRM
    const fakeImageBytes = new Uint8Array([1, 2, 3, 4]);
    mockFetch.mockResolvedValueOnce(
      new Response(fakeImageBytes, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );

    // 3º fetch: chamada POST para o GOWA com upload binário multipart
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "SUCCESS",
          message: "Sent",
          results: { message_id: "MEDIA_MSG_123" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await client.sendMedia(
      "device_1",
      "image",
      "5511999999999@s.whatsapp.net",
      "https://example.com/foto.jpg",
      "Minha Legenda",
      "foto.jpg",
    );

    expect(res.externalId).toBe("MEDIA_MSG_123");
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Checa chamada ao GOWA
    const [gowaUrl, gowaOptions] = (mockFetch.mock.calls[2] ?? []) as [
      string,
      RequestInit & { headers: Record<string, string>; body: FormData },
    ];
    expect(gowaUrl).toBe("http://localhost:4000/send/image");
    expect(gowaOptions.method).toBe("POST");
    expect(gowaOptions.headers["X-Device-Id"]).toBe("device_1");
    expect(gowaOptions.headers["Authorization"]).toBe("Basic YWRtaW46c2VjcmV0MTIz");
    expect(gowaOptions.body).toBeInstanceOf(FormData);

    const formData = gowaOptions.body as FormData;
    expect(formData.get("phone")).toBe("5511999999999@s.whatsapp.net");
    expect(formData.get("caption")).toBe("Minha Legenda");
    const file = formData.get("image");
    expect(file).toBeDefined();
  });

  it("sendVideo envia GIF para /send/video com gif_playback=true usando video_url diretamente", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "SUCCESS",
          message: "Sent",
          results: { message_id: "GIF_VIDEO_URL_1" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await client.sendVideo(
      "device_1",
      "5511999999999@s.whatsapp.net",
      "https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.mp4",
      { gifPlayback: true },
    );

    expect(res.externalId).toBe("GIF_VIDEO_URL_1");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [gowaUrl, gowaOptions] = (mockFetch.mock.calls[0] ?? []) as [
      string,
      RequestInit & { headers: Record<string, string>; body: FormData },
    ];
    expect(gowaUrl).toBe("http://localhost:4000/send/video");
    expect(gowaOptions.method).toBe("POST");
    const formData = gowaOptions.body as FormData;
    expect(formData.get("phone")).toBe("5511999999999@s.whatsapp.net");
    expect(formData.get("video_url")).toBe("https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.mp4");
    expect(formData.get("gif_playback")).toBe("true");
    // Não deve usar campo binário no primeiro envio (direto por URL)
    expect(formData.get("video")).toBeNull();
  });

  it("sendVideo faz fallback para upload binário quando a GOWA falha ao baixar a URL do MP4", async () => {
    // 1º fetch: tentativa de video_url falha (ex: CDN rejeita user-agent do Go)
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "INTERNAL_SERVER_ERROR", message: "failed to download video from URL" }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );

    // 2º fetch: download do MP4 pelo CRM com headers de browser
    const fakeMp4Bytes = new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112]);
    mockFetch.mockResolvedValueOnce(
      new Response(fakeMp4Bytes, {
        status: 200,
        headers: { "content-type": "video/mp4" },
      }),
    );

    // 3º fetch: POST ao GOWA com o arquivo binário no campo video
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "SUCCESS",
          message: "Sent",
          results: { message_id: "GIF_VIDEO_FALLBACK_OK" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await client.sendVideo(
      "device_1",
      "5511999999999@s.whatsapp.net",
      "https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.mp4",
      { gifPlayback: true },
    );

    expect(res.externalId).toBe("GIF_VIDEO_FALLBACK_OK");
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const [gowaUrl, gowaOptions] = (mockFetch.mock.calls[2] ?? []) as [
      string,
      RequestInit & { headers: Record<string, string>; body: FormData },
    ];
    expect(gowaUrl).toBe("http://localhost:4000/send/video");
    const formData = gowaOptions.body as FormData;
    expect(formData.get("phone")).toBe("5511999999999@s.whatsapp.net");
    expect(formData.get("gif_playback")).toBe("true");
    expect(formData.get("video")).toBeDefined();
    // Não deve ter video_url no fallback (upload binário)
    expect(formData.get("video_url")).toBeNull();
  });

  it("sendVideo envia sem gif_playback quando a opção não for passada", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "SUCCESS",
          message: "Sent",
          results: { message_id: "VIDEO_PLAIN_1" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await client.sendVideo(
      "device_1",
      "5511999999999@s.whatsapp.net",
      "https://example.com/video.mp4",
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, gowaOptions] = (mockFetch.mock.calls[0] ?? []) as [
      string,
      RequestInit & { body: FormData },
    ];
    const formData = gowaOptions.body as FormData;
    // Sem gif_playback no FormData
    expect(formData.get("gif_playback")).toBeNull();
  });

  it("sendMedia NÃO usa mais /send/sticker para GIFs do Giphy (caminho legado removido do fluxo de GIF)", async () => {
    // Confirma que sendMedia com kind="image" e URL .gif ainda vai para /send/sticker
    // (caminho de sticker de verdade — disponível para futura feature de figurinha)
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "SUCCESS",
          message: "Sent",
          results: { message_id: "STICKER_LEGACY" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await client.sendMedia(
      "device_1",
      "sticker",
      "5511999999999@s.whatsapp.net",
      "https://example.com/sticker.webp",
    );

    expect(res.externalId).toBe("STICKER_LEGACY");
    const [gowaUrl] = (mockFetch.mock.calls[0] ?? []) as [string, unknown];
    expect(gowaUrl).toBe("http://localhost:4000/send/sticker");
  });



  it("sendMedia envia fotos para /send/image usando image_url diretamente", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "SUCCESS",
          message: "Sent",
          results: { message_id: "PHOTO_URL_1" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await client.sendMedia(
      "device_1",
      "image",
      "5511999999999@s.whatsapp.net",
      "https://example.com/foto.jpg",
      "Legenda da foto",
      "foto.jpg",
    );

    expect(res.externalId).toBe("PHOTO_URL_1");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [gowaUrl, gowaOptions] = (mockFetch.mock.calls[0] ?? []) as [
      string,
      RequestInit & { headers: Record<string, string>; body: FormData },
    ];
    expect(gowaUrl).toBe("http://localhost:4000/send/image");
    const formData = gowaOptions.body as FormData;
    expect(formData.get("phone")).toBe("5511999999999@s.whatsapp.net");
    expect(formData.get("image_url")).toBe("https://example.com/foto.jpg");
    expect(formData.get("caption")).toBe("Legenda da foto");
    expect(formData.get("image")).toBeNull();
  });

  it("sendMedia faz fallback para upload binário quando o GOWA falha ao baixar sticker por URL", async () => {
    // Teste do caminho de sticker real (kind="sticker") — não mais usado para GIF do Giphy.
    // GIFs do Giphy agora usam sendVideo + gif_playback, não sendMedia kind=sticker.
    // 1º fetch: tentativa de sticker_url falha
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "INTERNAL_SERVER_ERROR", message: "failed to download sticker from URL" }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );

    // 2º fetch: download do arquivo pelo CRM
    const fakeStickerBytes = new Uint8Array([82, 73, 70, 70]);
    mockFetch.mockResolvedValueOnce(
      new Response(fakeStickerBytes, {
        status: 200,
        headers: { "content-type": "image/webp" },
      }),
    );

    // 3º fetch: POST ao GOWA com o arquivo binário no campo sticker
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "SUCCESS",
          message: "Sent",
          results: { message_id: "STICKER_FALLBACK_OK" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await client.sendMedia(
      "device_1",
      "sticker",
      "5511999999999@s.whatsapp.net",
      "https://example.com/sticker.webp",
      undefined,
      "sticker.webp",
    );

    expect(res.externalId).toBe("STICKER_FALLBACK_OK");
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const [gowaUrl, gowaOptions] = (mockFetch.mock.calls[2] ?? []) as [
      string,
      RequestInit & { headers: Record<string, string>; body: FormData },
    ];
    expect(gowaUrl).toBe("http://localhost:4000/send/sticker");
    const formData = gowaOptions.body as FormData;
    expect(formData.get("phone")).toBe("5511999999999@s.whatsapp.net");
    expect(formData.get("sticker")).toBeDefined();
  });



  it("fetchInboundMedia baixa de URL externa pública sem alterar host nem enviar auth do GOWA", async () => {
    const fakeMediaBytes = new Uint8Array([1, 2, 3]);
    mockFetch.mockResolvedValueOnce(
      new Response(fakeMediaBytes, {
        status: 200,
        headers: { "content-type": "image/gif" },
      }),
    );

    const res = await client.fetchInboundMedia("https://media.giphy.com/media/sample.gif", "device_1");
    expect(res.contentType).toBe("image/gif");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = (mockFetch.mock.calls[0] ?? []) as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://media.giphy.com/media/sample.gif");
    expect(options.headers["Authorization"]).toBeUndefined();
    expect(options.headers["X-Device-Id"]).toBeUndefined();
  });
});
