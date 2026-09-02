/**
 * lib/gowa/envelope.ts — Contrato de schemas Zod para webhooks do GOWA.
 *
 * Usa schemas loose para permitir campos adicionais do Baileys/GOWA sem
 * quebrar a ingestão de mensagens de clientes.
 */
import { z } from "zod";

import { conferirEnvelope, lerEnvelope, type LeituraDeEnvelope } from "@/lib/webhooks/contrato";

const texto = z.string().nullish();
const numero = z.number().nullish();
const booleano = z.boolean().nullish();

export const gowaPayloadSchema = z.looseObject({
  id: texto,
  chat_id: texto,
  from: texto,
  from_lid: texto,
  from_name: texto,
  sender_display_name: texto,
  timestamp: z.union([z.string(), z.number()]).nullish(),
  is_from_me: booleano,
  body: texto,
  has_media: booleano,
  media_url: texto,
  mime_type: texto,
  file_url: texto,
  image_url: texto,
  audio_url: texto,
  caption: texto,
  replied_to_id: texto,
  reply_message_id: texto,
  quoted_body: texto,
  ack: numero,
  status: texto,
  message: z.any().nullish(),
  key: z.any().nullish(),
  pushName: texto,
});

export const gowaEnvelopeSchema = z.looseObject({
  event: texto,
  device_id: texto,
  session_id: texto,
  payload: gowaPayloadSchema.nullish(),
  data: z.any().nullish(),
});

export type GowaPayload = z.infer<typeof gowaPayloadSchema>;
export type GowaEnvelope = z.infer<typeof gowaEnvelopeSchema>;

/**
 * Estágio 1: Esquema mínimo para roteamento e identificação da sessão.
 */
export const gowaRoteamentoSchema = z.looseObject({
  event: texto,
  device_id: texto,
  session_id: texto,
  payload: z.any().nullish(),
  data: z.any().nullish(),
});

export type GowaRoteamento = z.infer<typeof gowaRoteamentoSchema>;

export function lerRoteamentoGowa(rawBody: string): LeituraDeEnvelope<GowaRoteamento> {
  return lerEnvelope(rawBody, gowaRoteamentoSchema);
}

export function conferirContratoGowa(roteado: GowaRoteamento): LeituraDeEnvelope<GowaEnvelope> {
  return conferirEnvelope(roteado, gowaEnvelopeSchema);
}
