import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  crmListServices,
  crmListAvailableSlots,
  crmBookAppointment,
  crmUpdateAppointmentStatus,
} from "@/lib/mcp/tools/agendamento";
import type { McpContext } from "@/lib/mcp/types";

describe("MCP Tools de Agendamento (v1.11.0)", () => {
  const mockOrgId = "org-test-111";

  const createMockContext = (customSupabase: unknown = {}): McpContext => ({
    organizationId: mockOrgId,
    role: "agent",
    actor: {
      type: "user",
      id: "user-123",
      role: "agent",
    },
    apiTokenId: "",
    requestId: "req-123",
    supabase: customSupabase as SupabaseClient,
  });

  describe("crm_list_services", () => {
    it("devolve serviços ativos com preços e duração formatados", async () => {
      const mockServices = [
        {
          id: "serv-1",
          name: "Consulta Geral",
          description: "Consulta médica ou avaliação",
          duration_minutes: 30,
          price_cents: 15000,
          active: true,
        },
      ];

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: mockServices, error: null }),
              }),
            }),
          }),
        }),
      };

      const ctx = createMockContext(mockSupabase);
      const res = (await crmListServices.handler({ somente_ativos: true }, ctx)) as {
        servicos: Array<{ nome: string; preco_formatado: string }>;
      };

      expect(res.servicos).toHaveLength(1);
      expect(res.servicos[0]?.nome).toBe("Consulta Geral");
      expect(res.servicos[0]?.preco_formatado).toBe("R$ 150,00");
    });
  });

  describe("crm_list_available_slots", () => {
    it("gera horários concisos formatados em português", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "service_types") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { duration_minutes: 45 },
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "appointments") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    gte: vi.fn().mockReturnValue({
                      lte: vi.fn().mockResolvedValue({ data: [], error: null }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const ctx = createMockContext(mockSupabase);
      const res = (await crmListAvailableSlots.handler(
        { dias_a_frente: 5, limite_opcoes: 3, service_type_id: undefined },
        ctx,
      )) as {
        horarios_livres: Array<{ texto_legivel: string; scheduled_at_iso: string }>;
      };

      expect(res.horarios_livres.length).toBeLessThanOrEqual(3);
      if (res.horarios_livres.length > 0) {
        expect(res.horarios_livres[0]?.texto_legivel).toMatch(/às \d{2}:\d{2}/);
        expect(res.horarios_livres[0]?.scheduled_at_iso).toBeDefined();
      }
    });
  });

  describe("crm_book_appointment", () => {
    it("insere agendamento e aciona sincronização de funil", async () => {
      const mockContactId = "11111111-1111-4111-8111-111111111111";
      const scheduledIso = new Date(Date.now() + 86400000).toISOString();

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "crm_leads") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "lead-123", stage_id: "st-1" } }),
                  }),
                }),
              }),
            };
          }
          if (table === "crm_stages") {
            const chain: Record<string, unknown> = {
              eq: vi.fn(() => chain),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "st-agendado", slug: "agendamento-solicitado", pipeline_id: "pipe-1" },
                error: null,
              }),
            };
            return {
              select: vi.fn(() => chain),
            };
          }
          if (table === "appointments") {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "app-123",
                      organization_id: mockOrgId,
                      contact_id: mockContactId,
                      scheduled_at: scheduledIso,
                      duration_minutes: 30,
                      status: "pending",
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }),
      };

      const ctx = createMockContext(mockSupabase);
      const res = (await crmBookAppointment.handler(
        {
          contact_id: mockContactId,
          scheduled_at: scheduledIso,
          duration_minutes: 30,
          service_type_id: undefined,
          notes: undefined,
          confirmed: false,
        },
        ctx,
      )) as {
        sucesso: boolean;
        appointment_id: string;
        status: string;
      };

      expect(res.sucesso).toBe(true);
      expect(res.appointment_id).toBe("app-123");
      expect(res.status).toBe("pending");
    });
  });

  describe("crm_update_appointment_status", () => {
    it("impede marcar falta (no_show) para horário futuro", async () => {
      const futuro = new Date(Date.now() + 86400000 * 2).toISOString();
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "app-futuro", scheduled_at: futuro, status: "confirmed" },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };

      const ctx = createMockContext(mockSupabase);
      await expect(
        crmUpdateAppointmentStatus.handler(
          {
            appointment_id: "11111111-1111-4111-8111-111111111111",
            status: "no_show",
            notes: undefined,
          },
          ctx,
        ),
      ).rejects.toThrow("validacao_falhou");
    });
  });
});
