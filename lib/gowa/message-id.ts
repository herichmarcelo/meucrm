/**
 * lib/gowa/message-id.ts — Normalização e parse de IDs de mensagem do GOWA.
 */

export interface ParsedGowaMessageId {
  rawId: string;
  isFromMe?: boolean;
  participant?: string;
}

export function parseGowaMessageId(raw: unknown): ParsedGowaMessageId {
  let str = "";
  if (typeof raw === "string") {
    str = raw;
  } else if (typeof raw === "object" && raw !== null) {
    const r = raw as Record<string, unknown>;
    if (typeof r.id === "string") str = r.id;
    else if (typeof r.message_id === "string") str = r.message_id;
    else if (typeof r.results === "object" && r.results !== null) {
      const res = r.results as Record<string, unknown>;
      if (typeof res.id === "string") str = res.id;
      else if (typeof res.message_id === "string") str = res.message_id;
    }
  }

  if (!str) {
    return { rawId: "" };
  }

  // Se o formato for true_5511999999999@s.whatsapp.net_3EB0123456789ABCDEF
  const parts = str.split("_");
  if (parts.length >= 3 && (parts[0] === "true" || parts[0] === "false")) {
    const isFromMe = parts[0] === "true";
    const participant = parts[1];
    const rawId = parts.slice(2).join("_");
    return { rawId, isFromMe, participant };
  }

  return { rawId: str };
}

export function extractGowaMessageId(raw: unknown): string | null {
  const parsed = parseGowaMessageId(raw);
  return parsed.rawId.length > 0 ? parsed.rawId : null;
}

export function bareGowaMessageId(id: string): string {
  const cut = id.lastIndexOf("_");
  return cut === -1 ? id : id.slice(cut + 1);
}
