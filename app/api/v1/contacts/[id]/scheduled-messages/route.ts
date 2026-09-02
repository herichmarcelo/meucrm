/**
 * /api/v1/contacts/{id}/scheduled-messages
 *
 * GET  - Lista mensagens agendadas do contato
 * POST - Cria novo agendamento de mensagem para o contato
 *
 * Auth: Role `agent`+ e escopo estrito da organização ativa.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CreateScheduledMessageSchema = z.object({
  raw_body: z.string().trim().min(1, "O corpo da mensagem não pode ser vazio"),
  scheduled_for: z.string().datetime({ message: "Data/hora de agendamento inválida (ISO-8601 exigido)" }),
  conversation_id: z.string().uuid().optional().nullable(),
  template_id: z.string().uuid().optional().nullable(),
});

const CreateScheduledMessagesPayloadSchema = z.union([
  CreateScheduledMessageSchema,
  z.array(CreateScheduledMessageSchema).min(1, "Envie ao menos 1 agendamento").max(100, "Máximo de 100 agendamentos por requisição"),
]);

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: contactId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const activeOrg = authz.org;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("scheduled_messages")
    .select("*, template:template_id(id, title)")
    .eq("contact_id", contactId)
    .eq("organization_id", activeOrg.orgId)
    .order("scheduled_for", { ascending: false });

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  return ok(data ?? [], { requestId });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: contactId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const activeOrg = authz.org;
  const user = authz.user;

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return fail("bad_request", "JSON inválido no corpo da requisição.", 400, { requestId });
  }

  const parsed = CreateScheduledMessagesPayloadSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return fail("validation_failed", "Dados de agendamento inválidos.", 400, {
      requestId,
      details: parsed.error.format(),
    });
  }

  type SingleScheduledInput = z.infer<typeof CreateScheduledMessageSchema>;
  const isArray = Array.isArray(parsed.data);
  const items: SingleScheduledInput[] = isArray
    ? (parsed.data as SingleScheduledInput[])
    : [parsed.data as SingleScheduledInput];

  const now = Date.now();
  for (const item of items) {
    const scheduledDate = new Date(item.scheduled_for);
    if (scheduledDate.getTime() <= now) {
      return fail("unprocessable_entity", "A data de agendamento deve ser no futuro.", 422, { requestId });
    }
  }

  const admin = createAdminClient();

  // 1. Verifica se o contato existe e pertence à organização
  const { data: contact, error: contactErr } = await admin
    .from("contacts")
    .select("id, is_anonymized, is_blocked")
    .eq("id", contactId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (contactErr || !contact) {
    return fail("not_found", "Contato não encontrado.", 404, { requestId });
  }

  if (contact.is_anonymized || contact.is_blocked) {
    return fail("unprocessable_entity", "Não é permitido agendar mensagens para contatos bloqueados ou anonimizados.", 422, { requestId });
  }

  // 2. Insere a(s) mensagem(ns) agendada(s)
  const rows = items.map((item) => ({
    organization_id: activeOrg.orgId,
    contact_id: contactId,
    conversation_id: item.conversation_id || null,
    template_id: item.template_id || null,
    raw_body: item.raw_body,
    scheduled_for: item.scheduled_for,
    status: "pending",
    created_by_user_id: user.id,
  }));

  const { data: insertedRows, error: insertErr } = await admin
    .from("scheduled_messages")
    .insert(rows)
    .select();

  if (insertErr || !insertedRows || insertedRows.length === 0) {
    return fail("internal_error", insertErr?.message ?? "Falha ao registrar agendamento.", 500, { requestId });
  }

  // 3. Auditoria
  await audit({
    organizationId: activeOrg.orgId,
    actorUserId: user.id,
    action: "scheduled_message.created",
    resourceType: "scheduled_messages",
    resourceId: insertedRows[0].id,
    requestId,
    metadata: {
      contact_id: contactId,
      total_created: insertedRows.length,
      is_batch: isArray,
    },
  });

  const responseData = isArray ? insertedRows : insertedRows[0];
  return ok(responseData, { requestId, status: 201 });
}
