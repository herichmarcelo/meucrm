/**
 * GET  /api/v1/business-hours — Consulta o expediente comercial e feriados da organização.
 * PUT  /api/v1/business-hours — Atualiza slots de expediente comercial e feriados (requireRole manager).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const slotSchema = z
  .object({
    day_of_week: z.number().int().min(0).max(6),
    open_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Formato HH:mm ou HH:mm:ss"),
    close_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Formato HH:mm ou HH:mm:ss"),
    is_active: z.boolean(),
    timezone: z.string().min(1).default("America/Sao_Paulo"),
  })
  .refine((data) => data.close_time > data.open_time, {
    message: "close_time deve ser maior que open_time",
    path: ["close_time"],
  });

const holidaySchema = z.object({
  holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
  description: z.string().max(200).nullable().optional(),
});

const putBusinessHoursSchema = z.object({
  slots: z.array(slotSchema).min(1).max(7),
  holidays: z.array(holidaySchema).optional(),
});

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const admin = createAdminClient();

  const [slotsRes, holidaysRes] = await Promise.all([
    admin
      .from("business_hours_slots")
      .select("id, organization_id, day_of_week, open_time, close_time, is_active, timezone")
      .eq("organization_id", organizationId)
      .order("day_of_week", { ascending: true }),
    admin
      .from("business_holidays")
      .select("id, organization_id, holiday_date, description")
      .eq("organization_id", organizationId)
      .order("holiday_date", { ascending: true }),
  ]);

  if (slotsRes.error) {
    return fail("internal_error", slotsRes.error.message, 500, { requestId });
  }

  return ok(
    {
      slots: slotsRes.data ?? [],
      holidays: holidaysRes.data ?? [],
    },
    { requestId },
  );
}

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const body = await req.json().catch(() => null);
  const parsed = putBusinessHoursSchema.safeParse(body);

  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos para o horário comercial.", 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const { slots, holidays } = parsed.data;
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // 1. Upsert dos slots de horário comercial
  const slotsPayload = slots.map((s) => ({
    organization_id: organizationId,
    day_of_week: s.day_of_week,
    open_time: s.open_time.length === 5 ? `${s.open_time}:00` : s.open_time,
    close_time: s.close_time.length === 5 ? `${s.close_time}:00` : s.close_time,
    is_active: s.is_active,
    timezone: s.timezone,
    updated_at: now,
  }));

  const { data: updatedSlots, error: slotsError } = await admin
    .from("business_hours_slots")
    .upsert(slotsPayload, { onConflict: "organization_id,day_of_week" })
    .select("id, organization_id, day_of_week, open_time, close_time, is_active, timezone");

  if (slotsError) {
    return fail("internal_error", slotsError.message, 500, { requestId });
  }

  // 2. Se houver feriados informados, insere/atualiza
  let updatedHolidays: unknown[] = [];
  if (holidays && holidays.length > 0) {
    const holidaysPayload = holidays.map((h) => ({
      organization_id: organizationId,
      holiday_date: h.holiday_date,
      description: h.description ?? null,
    }));

    const { data: hData, error: hError } = await admin
      .from("business_holidays")
      .upsert(holidaysPayload, { onConflict: "organization_id,holiday_date" })
      .select("id, organization_id, holiday_date, description");

    if (hError) {
      return fail("internal_error", hError.message, 500, { requestId });
    }
    updatedHolidays = hData ?? [];
  }

  await audit({
    action: "business_hours.updated",
    organizationId,
    actorUserId: authz.user.id,
    resourceType: "business_hours",
    resourceId: organizationId,
    metadata: {
      slotsCount: slots.length,
      holidaysCount: holidays?.length ?? 0,
    },
  });

  return ok(
    {
      slots: updatedSlots,
      holidays: updatedHolidays,
    },
    { requestId, status: 200 },
  );
}
