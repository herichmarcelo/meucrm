/**
 * lib/gowa/client.ts — Cliente HTTP REST para GOWA (go-whatsapp-web-multidevice).
 *
 * Suporta autenticação HTTP Basic Auth e controle multi-device via header `X-Device-Id`.
 */
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { extractGowaMessageId } from "./message-id";

export interface GowaDeviceStatus {
  isConnected: boolean;
  isLoggedIn: boolean;
  jid: string | null;
  name?: string | null;
}

export interface GowaQrLoginResult {
  qrLink: string | null;
  qrDuration: number;
}

export interface GowaSendResult {
  externalId: string | null;
}

export class GowaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly user: string,
    private readonly pass: string,
  ) {}

  private authHeader(): string {
    const creds = `${this.user}:${this.pass}`;
    return `Basic ${Buffer.from(creds).toString("base64")}`;
  }

  private defaultHeaders(deviceId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (deviceId) {
      headers["X-Device-Id"] = deviceId;
    }
    return headers;
  }

  /**
   * Registra um novo device no GOWA.
   * Idempotente: se já existir (400/409/422), não lança.
   */
  async addDevice(
    deviceId: string,
    webhookUrl?: string,
    webhookSecret?: string,
  ): Promise<{ deviceId: string }> {
    const body: Record<string, unknown> = { device_id: deviceId };
    if (webhookUrl) body.webhook_url = webhookUrl;
    if (webhookSecret) body.webhook_secret = webhookSecret;
    body.webhook_events = "message,message.ack";

    const res = await fetch(`${this.baseUrl}/devices`, {
      method: "POST",
      headers: this.defaultHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok && res.status !== 400 && res.status !== 409 && res.status !== 422) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`gowa_add_device_${res.status}: ${errorText.slice(0, 200)}`);
    }

    return { deviceId };
  }

  /**
   * Inicia o fluxo de login por QR Code para o device especificado.
   */
  async loginDevice(deviceId: string): Promise<GowaQrLoginResult> {
    // Tenta primeiro /app/login com header X-Device-Id (padrão oficial do GOWA v9)
    let res = await fetch(`${this.baseUrl}/app/login`, {
      method: "GET",
      headers: this.defaultHeaders(deviceId),
    });

    if (!res.ok && (res.status === 404 || res.status === 405)) {
      // Fallback para /devices/{id}/login
      res = await fetch(`${this.baseUrl}/devices/${encodeURIComponent(deviceId)}/login`, {
        method: "GET",
        headers: this.defaultHeaders(deviceId),
      });
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`gowa_login_${res.status}: ${errorText.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      results?: { qr_link?: string; qr_duration?: number; qr_code?: string; url?: string; image?: string };
    };

    const results = json.results ?? {};
    const qrLink = results.qr_link ?? results.url ?? results.qr_code ?? results.image ?? null;
    const qrDuration = results.qr_duration ?? 20;

    return { qrLink, qrDuration };
  }

  /**
   * Baixa a imagem PNG do QR Code do GOWA.
   */
  async fetchQrImage(qrLinkOrPath: string, deviceId?: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
    if (qrLinkOrPath.startsWith("data:image/")) {
      const match = qrLinkOrPath.match(/^data:([^;]+);base64,(.+)$/);
      if (match && match[1] && match[2]) {
        const contentType = match[1];
        const buffer = Buffer.from(match[2], "base64");
        return {
          buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          contentType,
        };
      }
    }

    let url = qrLinkOrPath;
    if (url.startsWith("http://") || url.startsWith("https://")) {
      try {
        const parsed = new URL(url);
        // Garante que usa a baseUrl do GOWA configurada em vez do hostname interno do container
        url = `${this.baseUrl.replace(/\/+$/, "")}${parsed.pathname}${parsed.search}`;
      } catch {
        // mantém url se falhar o parse
      }
    } else {
      url = `${this.baseUrl.replace(/\/+$/, "")}/${qrLinkOrPath.replace(/^\/+/, "")}`;
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
    };
    if (deviceId) {
      headers["X-Device-Id"] = deviceId;
    }

    const res = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`gowa_qr_fetch_${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "image/png";
    const buffer = await res.arrayBuffer();
    return { buffer, contentType };
  }

  /**
   * Baixa mídia recebida de uma mensagem do GOWA ou URL externa.
   */
  async fetchInboundMedia(mediaUrlOrPath: string, deviceId?: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
    let url: string;
    let isExternalUrl = false;

    if (mediaUrlOrPath.startsWith("http://") || mediaUrlOrPath.startsWith("https://")) {
      try {
        const parsed = new URL(mediaUrlOrPath);
        const base = new URL(this.baseUrl);
        const isGowaLocal =
          parsed.hostname === base.hostname ||
          ["localhost", "127.0.0.1", "host.docker.internal", "gowa"].includes(parsed.hostname);

        if (isGowaLocal) {
          url = `${this.baseUrl.replace(/\/+$/, "")}${parsed.pathname}${parsed.search}`;
        } else {
          // URL externa pública (ex: Giphy, Supabase Storage público, etc.)
          url = mediaUrlOrPath;
          isExternalUrl = true;
        }
      } catch {
        url = mediaUrlOrPath;
      }
    } else {
      url = `${this.baseUrl.replace(/\/+$/, "")}/${mediaUrlOrPath.replace(/^\/+/, "")}`;
    }

    const headers: Record<string, string> = {};
    if (!isExternalUrl) {
      headers["Authorization"] = this.authHeader();
      if (deviceId) {
        headers["X-Device-Id"] = deviceId;
      }
    }

    const res = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`gowa_media_fetch_${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const buffer = await res.arrayBuffer();
    return { buffer, contentType };
  }

  /**
   * Consulta o status de conexão de um device.
   */
  async getDeviceStatus(deviceId: string): Promise<GowaDeviceStatus> {
    const res = await fetch(`${this.baseUrl}/app/status`, {
      method: "GET",
      headers: this.defaultHeaders(deviceId),
      cache: "no-store",
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`gowa_status_${res.status}: ${errorText.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      results?: { is_connected?: boolean; is_logged_in?: boolean; jid?: string };
    };

    const results = json.results ?? {};
    return {
      isConnected: Boolean(results.is_connected),
      isLoggedIn: Boolean(results.is_logged_in),
      jid: results.jid ?? null,
      name: (results as { name?: string }).name ?? null,
    };
  }

  /**
   * Envia uma mensagem de texto simples.
   */
  async sendText(
    deviceId: string,
    phone: string,
    message: string,
    replyToId?: string | null,
  ): Promise<GowaSendResult> {
    const body: Record<string, unknown> = {
      phone,
      message,
    };
    if (replyToId) {
      body.reply_message_id = replyToId;
    }

    const res = await fetch(`${this.baseUrl}/send/message`, {
      method: "POST",
      headers: this.defaultHeaders(deviceId),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`gowa_send_text_${res.status}: ${errorText.slice(0, 200)}`);
    }

    const json = await res.json();
    return { externalId: extractGowaMessageId(json) };
  }

  /**
   * Envia mídia (imagem, áudio ou arquivo) via multipart/form-data.
   *
   * O endpoint do GOWA espera o campo do arquivo (`image`, `audio` ou `file`)
   * como upload multipart binário (`multipart.FileHeader` no backend Go).
   * Baixa a mídia previamente (URL assinada do Storage ou URL externa de GIF)
   * e monta a requisição multipart correta.
   */
  async sendMedia(
    deviceId: string,
    kind: "image" | "file" | "audio" | "sticker",
    phone: string,
    mediaUrl: string,
    caption?: string,
    filename?: string,
    mimeType?: string,
  ): Promise<GowaSendResult> {
    const isGif =
      mimeType === "image/gif" ||
      (mimeType ? mimeType.toLowerCase().includes("gif") : false) ||
      mediaUrl.toLowerCase().includes(".gif") ||
      Boolean(filename && filename.toLowerCase().endsWith(".gif"));

    const isHttpUrl = mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://");

    // 1. Tenta envio direto por URL para image (image_url) e sticker/gif (sticker_url)
    if (isHttpUrl) {
      if (kind === "sticker" || (kind === "image" && isGif)) {
        try {
          const form = new FormData();
          form.append("phone", phone);
          form.append("sticker_url", mediaUrl);

          const res = await fetch(`${this.baseUrl}/send/sticker`, {
            method: "POST",
            headers: this.defaultHeaders(deviceId),
            body: form,
          });

          if (res.ok) {
            const json = await res.json();
            return { externalId: extractGowaMessageId(json) };
          }
          // Se o GOWA falhar ao baixar a URL externa (ex: 404 por User-Agent em CDNs como Giphy),
          // prossegue para o fallback seguro de upload binário via buffer.
        } catch {
          // prossegue para fallback
        }
      } else if (kind === "image") {
        try {
          const form = new FormData();
          form.append("phone", phone);
          form.append("image_url", mediaUrl);
          if (caption) {
            form.append("caption", caption);
          }

          const res = await fetch(`${this.baseUrl}/send/image`, {
            method: "POST",
            headers: this.defaultHeaders(deviceId),
            body: form,
          });

          if (res.ok) {
            const json = await res.json();
            return { externalId: extractGowaMessageId(json) };
          }
        } catch {
          // prossegue para fallback
        }
      }
    }

    // 2. Caminho de Upload Binário Multipart (para data URLs, arquivos, áudios ou fallback de CDN)
    let arrayBuffer: ArrayBuffer;
    let contentType = "application/octet-stream";

    if (mediaUrl.startsWith("data:")) {
      const match = mediaUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match && match[1] && match[2]) {
        contentType = match[1];
        const buf = Buffer.from(match[2], "base64");
        arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } else {
        throw new Error("gowa_invalid_data_url");
      }
    } else {
      const mediaRes = await fetch(mediaUrl, {
        signal: AbortSignal.timeout(30_000),
      });

      if (!mediaRes.ok) {
        throw new Error(`gowa_media_download_failed_${mediaRes.status}`);
      }

      contentType = mediaRes.headers.get("content-type") ?? contentType;
      arrayBuffer = await mediaRes.arrayBuffer();
    }

    const isDetectedGif = isGif || contentType.includes("gif");
    let endpoint = "/send/file";
    let fieldName = "file";
    let defaultFilename = "file.bin";
    let allowCaption = true;

    if (kind === "sticker" || (kind === "image" && isDetectedGif)) {
      endpoint = "/send/sticker";
      fieldName = "sticker";
      defaultFilename = isDetectedGif ? "animated.gif" : "sticker.webp";
      allowCaption = false;
    } else if (kind === "image") {
      endpoint = "/send/image";
      fieldName = "image";
      defaultFilename = "image.jpg";
    } else if (kind === "audio") {
      endpoint = "/send/audio";
      fieldName = "audio";
      defaultFilename = "audio.mp3";
    }

    const resolvedFilename = filename || defaultFilename;
    const blob = new Blob([arrayBuffer], { type: contentType });

    const formData = new FormData();
    formData.append("phone", phone);
    if (caption && allowCaption) {
      formData.append("caption", caption);
    }
    formData.append(fieldName, blob, resolvedFilename);

    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      Accept: "application/json",
    };
    if (deviceId) {
      headers["X-Device-Id"] = deviceId;
    }

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`gowa_send_media_${res.status}: ${errorText.slice(0, 200)}`);
    }

    const json = await res.json();
    return { externalId: extractGowaMessageId(json) };
  }

  /**
   * Envia um vídeo via GOWA, com suporte opcional a gif_playback.
   *
   * Quando `gifPlayback: true`, o WhatsApp exibe o vídeo como GIF animado em loop
   * nativo — equivalente ao que o app oficial faz para GIFs do Giphy.
   *
   * Tenta primeiro envio direto por URL (video_url). Se o GOWA não conseguir
   * baixar o MP4 da CDN (User-Agent bloqueado, Content-Type rejeitado), faz
   * fallback: baixa os bytes no CRM e reenvia como upload multipart binário.
   *
   * NOTA: assume que a URL já é MP4 válido. Se a origem for upload arbitrário
   * de `.gif` (não do seletor do Giphy), não haverá variante MP4 disponível —
   * nesse caso seria necessário conversão via ffmpeg no servidor (não implementado).
   */
  async sendVideo(
    deviceId: string,
    phone: string,
    mediaUrl: string,
    options: { gifPlayback?: boolean } = {},
  ): Promise<GowaSendResult> {
    const isHttpUrl = mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://");

    // 1. Tenta envio direto por video_url (mais eficiente — GOWA baixa direto)
    if (isHttpUrl) {
      try {
        const form = new FormData();
        form.append("phone", phone);
        form.append("video_url", mediaUrl);
        if (options.gifPlayback) {
          form.append("gif_playback", "true");
        }

        const res = await fetch(`${this.baseUrl}/send/video`, {
          method: "POST",
          headers: this.defaultHeaders(deviceId),
          body: form,
        });

        if (res.ok) {
          const json = await res.json();
          return { externalId: extractGowaMessageId(json) };
        }
        // Se o GOWA falhar ao baixar a URL externa (CDN bloqueando o user-agent do Go,
        // Content-Type recusado etc.), prossegue para o fallback de upload binário.
      } catch {
        // prossegue para fallback
      }
    }

    // 2. Fallback: baixa o MP4 com headers completos do Node e reenvia como buffer
    let arrayBuffer: ArrayBuffer;

    if (mediaUrl.startsWith("data:")) {
      const match = mediaUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match && match[2]) {
        const buf = Buffer.from(match[2], "base64");
        arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } else {
        throw new Error("gowa_invalid_data_url");
      }
    } else {
      const mediaRes = await fetch(mediaUrl, {
        signal: AbortSignal.timeout(30_000),
        headers: {
          // Headers completos para contornar CDNs que bloqueiam user-agents não-browser
          "User-Agent": "Mozilla/5.0 (compatible; DeskcommCRM/1.0)",
          Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
        },
      });

      if (!mediaRes.ok) {
        throw new Error(`gowa_video_download_failed_${mediaRes.status}`);
      }

      arrayBuffer = await mediaRes.arrayBuffer();
    }

    const blob = new Blob([arrayBuffer], { type: "video/mp4" });
    const formData = new FormData();
    formData.append("phone", phone);
    formData.append("video", blob, "animacao.mp4");
    if (options.gifPlayback) {
      formData.append("gif_playback", "true");
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      Accept: "application/json",
    };
    if (deviceId) {
      headers["X-Device-Id"] = deviceId;
    }

    const res = await fetch(`${this.baseUrl}/send/video`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`gowa_send_video_${res.status}: ${errorText.slice(0, 200)}`);
    }

    const json = await res.json();
    return { externalId: extractGowaMessageId(json) };
  }


  async logoutDevice(deviceId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/devices/${encodeURIComponent(deviceId)}/logout`, {
      method: "POST",
      headers: this.defaultHeaders(deviceId),
      body: JSON.stringify({}),
    });

    if (!res.ok && res.status !== 404) {
      const errorText = await res.text().catch(() => "");
      logger.warn("[gowa.client] logoutDevice retornou status não-ok", { status: res.status, errorText });
    }
  }

  /**
   * Remove o device do GOWA completamente.
   */
  async deleteDevice(deviceId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
      headers: this.defaultHeaders(deviceId),
    });

    if (!res.ok && res.status !== 404) {
      const errorText = await res.text().catch(() => "");
      logger.warn("[gowa.client] deleteDevice retornou status não-ok", { status: res.status, errorText });
    }
  }

  /**
   * Obtém a URL da foto de perfil do contato via GOWA.
   */
  async fetchProfilePictureUrl(deviceId: string, phone: string): Promise<string | null> {
    try {
      const cleanPhone = phone.replace(/\D/g, "");
      const res = await fetch(`${this.baseUrl}/user/avatar?phone=${encodeURIComponent(cleanPhone)}`, {
        method: "GET",
        headers: this.defaultHeaders(deviceId),
        cache: "no-store",
      });

      if (!res.ok) return null;
      const json = (await res.json()) as {
        results?: { url?: string; avatar_url?: string; avatar_path?: string; avatar?: string };
        url?: string;
        avatar_url?: string;
      };

      const rawUrl =
        json.results?.url ??
        json.results?.avatar_url ??
        json.results?.avatar ??
        json.results?.avatar_path ??
        json.avatar_url ??
        json.url ??
        null;

      if (!rawUrl) return null;
      if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
        return rawUrl;
      }
      return `${this.baseUrl.replace(/\/+$/, "")}/${rawUrl.replace(/^\/+/, "")}`;
    } catch {
      return null;
    }
  }
}

/**
 * Retorna uma instância de `GowaClient` baseada no ambiente ou `null` se não configurado.
 */
export function getGowaClient(): GowaClient | null {
  const baseUrl = (env.GOWA_API_BASE_URL ?? "").trim();
  const user = (env.GOWA_API_USER ?? "").trim();
  const pass = (env.GOWA_API_PASS ?? "").trim();

  if (!baseUrl || !user) return null;
  return new GowaClient(baseUrl, user, pass);
}
