/**
 * lib/gowa/send.ts — Resolução de endereço WhatsApp para GOWA.
 */
export interface ResolveGowaChatIdInput {
  isGroup?: boolean;
  groupChatId?: string | null;
  phoneNumber?: string | null;
  phone?: string | null;
  waIdentity?: string | null;
  waLid?: string | null;
}

/**
 * Resolve o identificador de chat compatível com GOWA.
 *
 * GOWA utiliza `@s.whatsapp.net` para conversas 1:1 com telefone,
 * `@lid` para contatos identificados por Linked ID e
 * `@g.us` para grupos.
 */
export function resolveGowaChatId(input: string | ResolveGowaChatIdInput): string | null {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (trimmed.endsWith("@g.us") || trimmed.endsWith("@lid") || trimmed.endsWith("@s.whatsapp.net")) {
      return trimmed;
    }
    if (trimmed.endsWith("@c.us")) {
      const digits = trimmed.replace(/@.*$/, "").replace(/\D/g, "");
      return digits.length >= 8 ? `${digits}@s.whatsapp.net` : null;
    }
    const digits = trimmed.replace(/\D/g, "");
    return digits.length >= 8 ? `${digits}@s.whatsapp.net` : null;
  }

  if (input.isGroup && input.groupChatId) return input.groupChatId;
  if (input.groupChatId && input.groupChatId.endsWith("@g.us")) return input.groupChatId;
  if (input.waLid) return `${input.waLid}@lid`;
  if (input.waIdentity?.startsWith("lid:")) return `${input.waIdentity.slice(4)}@lid`;
  
  const rawPhone = input.phoneNumber || input.phone;
  if (rawPhone) {
    return resolveGowaChatId(rawPhone);
  }
  return null;
}

