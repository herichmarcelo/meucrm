/**
 * /api/v1/scheduled-messages/{id}
 *
 * PATCH  - Reagenda data/hora ou atualiza o corpo da mensagem agendada (se status === 'pending')
 * DELETE - Cancela a mensagem agendada (soft cancel: status = 'cancelled')
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

const UpdateScheduledMessageSchema = z
  .object({
    raw_body: z.string().trim().min(1, "O corpo da mensagem não pode ser vazio").optional(),
    scheduled_for: z.string().datetime({ message: "Data/hora inválida" }).optional(),
  })
  .refine((data) => data.raw_body !== undefined || data.scheduled_for !== undefined, {
    message: "Informe ao menos um campo para atualização (raw_body ou scheduled_for).",
  });

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: scheduledMessageId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "scheduled_messages" });
  if (!authz.ok) return authz.response;
  const activeOrg = authz.org;
  const user = authz.user;

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return fail("bad_request", "JSON inválido no corpo da requisição.", 400, { requestId });
  }

  const parsed = UpdateScheduledMessageSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return fail("validation_failed", "Dados de atualização inválidos.", 400, {
      requestId,
      details: parsed.error.format(),
    });
  }

  const { raw_body, scheduled_for } = parsed.data;

  if (scheduled_for) {
    const scheduledDate = new Date(scheduled_for);
    if (scheduledDate.getTime() <= Date.now()) {
      return fail("unprocessable_entity", "A nova data de agendamento deve ser no futuro.", 422, { requestId });
    }
  }

  const admin = createAdminClient();

  // 1. Busca a mensagem agendada e valida status
  const { data: scheduled, error: fetchErr } = await admin
    .from("scheduled_messages")
    .select("id, status, scheduled_for, raw_body, contact_id")
    .eq("id", scheduledMessageId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (fetchErr || !scheduled) {
    return fail("not_found", "Mensagem agendada não encontrada.", 404, { requestId });
  }

  if (scheduled.status !== "pending") {
    return fail("unprocessable_entity", `Não é possível alterar uma mensagem com status '${scheduled.status}'.`, 422, { requestId });
  }

  // 2. Atualiza a mensagem
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (raw_body !== undefined) updates.raw_body = raw_body;
  if (scheduled_for !== undefined) updates.scheduled_for = scheduled_for;

  const { data: updated, error: updateErr } = await admin
    .from("scheduled_messages")
    .update(updates)
    .eq("id", scheduledMessageId)
    .eq("organization_id", activeOrg.orgId)
    .select()
    .single();

  if (updateErr || !updated) {
    return fail("internal_error", updateErr?.message ?? "Falha ao atualizar agendamento.", 500, { requestId });
  }

  // 3. Auditoria
  await audit({
    organizationId: activeOrg.orgId,
    actorUserId: user.id,
    action: "scheduled_message.updated",
    resourceType: "scheduled_messages",
    resourceId: scheduledMessageId,
    requestId,
    metadata: {
      previous_scheduled_for: scheduled.scheduled_for,
      new_scheduled_for: scheduled_for,
    },
  });

  return ok(updated, { requestId });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: scheduledMessageId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "scheduled_messages" });
  if (!authz.ok) return authz.response;
  const activeOrg = authz.org;
  const user = authz.user;

  const admin = createAdminClient();

  // 1. Busca a mensagem agendada
  const { data: scheduled, error: fetchErr } = await admin
    .from("scheduled_messages")
    .select("id, status, scheduled_for, contact_id")
    .eq("id", scheduledMessageId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (fetchErr || !scheduled) {
    return fail("not_found", "Mensagem agendada não encontrada.", 404, { requestId });
  }

  if (scheduled.status !== "pending") {
    return fail("unprocessable_entity", `Não é possível cancelar uma mensagem com status '${scheduled.status}'.`, 422, { requestId });
  }

  // 2. Soft cancel
  const { data: cancelled, error: cancelErr } = await admin
    .from("scheduled_messages")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", scheduledMessageId)
    .eq("organization_id", activeOrg.orgId)
    .select()
    .single();

  if (cancelErr || !cancelled) {
    return fail("internal_error", cancelErr?.message ?? "Falha ao cancelar agendamento.", 500, { requestId });
  }

  // 3. Auditoria
  await audit({
    organizationId: activeOrg.orgId,
    actorUserId: user.id,
    action: "scheduled_message.cancelled",
    resourceType: "scheduled_messages",
    resourceId: scheduledMessageId,
    requestId,
    metadata: {
      contact_id: scheduled.contact_id,
      scheduled_for: scheduled.scheduled_for,
    },
  });

  return ok({ success: true, cancelled: true, message: cancelled }, { requestId });
}
