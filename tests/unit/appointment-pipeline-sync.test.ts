import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncAppointmentStage } from "@/lib/appointments/pipeline-sync";

describe("syncAppointmentStage (Funil Automático)", () => {
  const orgId = "org-test-999";
  const leadId = "lead-test-123";

  it("retorna moved: false quando lead_id é nulo", async () => {
    const mockAdmin = {} as unknown as SupabaseClient;
    const res = await syncAppointmentStage(mockAdmin, orgId, null, "pending");
    expect(res.moved).toBe(false);
    expect(res.reason).toBe("lead_id_nulo");
  });

  it("retorna moved: false para status que não movem funil (ex: attended, no_show, canceled)", async () => {
    const mockAdmin = {} as unknown as SupabaseClient;
    const res = await syncAppointmentStage(mockAdmin, orgId, leadId, "canceled");
    expect(res.moved).toBe(false);
    expect(res.reason).toBe("status_nao_move_funil");
  });

  it("move lead para etapa 'agendamento-solicitado' quando agendamento é pending", async () => {
    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    const insertSpy = vi.fn().mockResolvedValue({ error: null });

    const createStageChain = (data: Record<string, unknown>) => {
      const chain: Record<string, unknown> = {
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
      };
      return chain;
    };

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === "crm_leads") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: leadId, stage_id: "stage-inicial", organization_id: orgId },
                    error: null,
                  }),
                }),
              }),
            }),
            update: updateSpy,
          };
        }
        if (table === "crm_stages") {
          return {
            select: vi.fn((cols: string) => {
              if (cols.includes("pipeline_id, slug")) {
                return createStageChain({ pipeline_id: "pipe-1", slug: "stage-inicial" });
              }
              return createStageChain({
                id: "stage-solicitado-id",
                name: "Agendamento Solicitado",
                slug: "agendamento-solicitado",
                pipeline_id: "pipe-1",
              });
            }),
          };
        }
        if (table === "crm_lead_activities") {
          return { insert: insertSpy };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const res = await syncAppointmentStage(mockAdmin, orgId, leadId, "pending");
    expect(res.moved).toBe(true);
    expect(res.targetSlug).toBe("agendamento-solicitado");
    expect(res.targetStageId).toBe("stage-solicitado-id");
    expect(updateSpy).toHaveBeenCalled();
    expect(insertSpy).toHaveBeenCalled();
  });

  it("move lead para etapa 'agendado' quando agendamento é confirmed", async () => {
    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    const insertSpy = vi.fn().mockResolvedValue({ error: null });

    const createStageChain = (data: Record<string, unknown>) => {
      const chain: Record<string, unknown> = {
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
      };
      return chain;
    };

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === "crm_leads") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: leadId, stage_id: "stage-solicitado-id", organization_id: orgId },
                    error: null,
                  }),
                }),
              }),
            }),
            update: updateSpy,
          };
        }
        if (table === "crm_stages") {
          return {
            select: vi.fn((cols: string) => {
              if (cols.includes("pipeline_id, slug")) {
                return createStageChain({ pipeline_id: "pipe-1", slug: "agendamento-solicitado" });
              }
              return createStageChain({
                id: "stage-confirmado-id",
                name: "Agendado",
                slug: "agendado",
                pipeline_id: "pipe-1",
              });
            }),
          };
        }
        if (table === "crm_lead_activities") {
          return { insert: insertSpy };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const res = await syncAppointmentStage(mockAdmin, orgId, leadId, "confirmed");
    expect(res.moved).toBe(true);
    expect(res.targetSlug).toBe("agendado");
    expect(res.targetStageId).toBe("stage-confirmado-id");
  });
});
