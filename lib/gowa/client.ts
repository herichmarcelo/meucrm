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
   * Baixa mídia recebida de uma mensagem do GOWA.
   */
  async fetchInboundMedia(mediaUrlOrPath: string, deviceId?: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
    let url: string;
    if (mediaUrlOrPath.startsWith("http://") || mediaUrlOrPath.startsWith("https://")) {
      try {
        const parsed = new URL(mediaUrlOrPath);
        url = `${this.baseUrl.replace(/\/+$/, "")}${parsed.pathname}${parsed.search}`;
      } catch {
        url = mediaUrlOrPath;
      }
    } else {
      url = `${this.baseUrl.replace(/\/+$/, "")}/${mediaUrlOrPath.replace(/^\/+/, "")}`;
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
    kind: "image" | "file" | "audio",
    phone: string,
    mediaUrl: string,
    caption?: string,
    filename?: string,
  ): Promise<GowaSendResult> {
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

    let endpoint = "/send/file";
    let fieldName = "file";
    let defaultFilename = "file.bin";

    if (kind === "image") {
      endpoint = "/send/image";
      fieldName = "image";
      defaultFilename = contentType.includes("gif") ? "animation.gif" : "image.jpg";
    } else if (kind === "audio") {
      endpoint = "/send/audio";
      fieldName = "audio";
      defaultFilename = "audio.mp3";
    }

    const resolvedFilename = filename || defaultFilename;
    const blob = new Blob([arrayBuffer], { type: contentType });

    const formData = new FormData();
    formData.append("phone", phone);
    if (caption) {
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
   * Realiza logout do device no WhatsApp preservando o slot registrado.
   */
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
