import { describe, expect, it, vi } from "vitest";
import {
  atualizarPausaDemanda,
  registrarPrimeiraRespostaOutbound,
  resolverTipoAtendimentoDemanda,
} from "@/lib/sla/sla-tracking";
import type { SupabaseClient } from "@supabase/supabase-js";

const ORG = "22222222-2222-4222-8222-222222222222";
const DEMANDA_ID = "33333333-3333-4333-8333-333333333333";
const CONV_1 = "44444444-4444-4444-8444-444444444444";

describe("lib/sla/sla-tracking", () => {
  describe("resolverTipoAtendimentoDemanda", () => {
    it("resolve o tipo de atendimento a partir da PRIMEIRA conversa vinculada", async () => {
      const mockSelectConversas = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  conversation_id: CONV_1,
                  created_at: "2026-09-10T10:00:00Z",
                  conversations: {
                    id: CONV_1,
                    organization_id: ORG,
                    tags: ["suporte", "urgente"],
                  },
                },
              ],
              error: null,
            }),
          }),
        }),
      });

      const mockSelectTags = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  name: "suporte",
                  group_slug: "tipo_atendimento",
                  is_exclusive: true,
                  is_csat_enabled: true,
                  sla_first_response_minutes: 60,
                  sla_resolution_minutes: 1440,
                },
              ],
              error: null,
            }),
          }),
        }),
      });

      const client = {
        from: vi.fn((table: string) => {
          if (table === "demanda_conversas") {
            return { select: mockSelectConversas };
          }
          return { select: mockSelectTags };
        }),
      } as unknown as SupabaseClient;

      const info = await resolverTipoAtendimentoDemanda(DEMANDA_ID, client);
      expect(info).not.toBeNull();
      expect(info?.tag_name).toBe("suporte");
      expect(info?.first_response_minutes).toBe(60);
      expect(info?.resolution_minutes).toBe(1440);
      expect(info?.is_csat_enabled).toBe(true);
      expect(info?.first_conversation_id).toBe(CONV_1);
    });
  });

  describe("atualizarPausaDemanda", () => {
    it("inicia pausa ao transicionar para aguardando_cliente", async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const client = {
        from: vi.fn().mockReturnValue({ update: mockUpdate }),
      } as unknown as SupabaseClient;

      await atualizarPausaDemanda(DEMANDA_ID, "aguardando_cliente", "em_atendimento", client);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          sla_paused_at: expect.any(String),
        }),
      );
    });

    it("acumula segundos de pausa ao sair de aguardando_cliente", async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockSingle = vi.fn().mockResolvedValue({
        data: {
          id: DEMANDA_ID,
          organization_id: ORG,
          sla_paused_at: new Date(Date.now() - 3600 * 1000).toISOString(), // 1 hora atrás
          sla_total_paused_seconds: 500,
        },
        error: null,
      });

      const mockSlots = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [
            { day_of_week: 0, open_time: "08:00:00", close_time: "18:00:00", is_active: false },
            { day_of_week: 1, open_time: "08:00:00", close_time: "18:00:00", is_active: true },
            { day_of_week: 2, open_time: "08:00:00", close_time: "18:00:00", is_active: true },
            { day_of_week: 3, open_time: "08:00:00", close_time: "18:00:00", is_active: true },
            { day_of_week: 4, open_time: "08:00:00", close_time: "18:00:00", is_active: true },
            { day_of_week: 5, open_time: "08:00:00", close_time: "18:00:00", is_active: true },
            { day_of_week: 6, open_time: "08:00:00", close_time: "18:00:00", is_active: false },
          ],
        }),
      });

      const mockHolidays = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [] }),
      });

      const client = {
        from: vi.fn((table: string) => {
          if (table === "demandas") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({ single: mockSingle }),
              }),
              update: mockUpdate,
            };
          }
          if (table === "business_hours_slots") {
            return { select: mockSlots };
          }
          return { select: mockHolidays };
        }),
      } as unknown as SupabaseClient;

      await atualizarPausaDemanda(DEMANDA_ID, "em_atendimento", "aguardando_cliente", client);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          sla_paused_at: null,
          sla_total_paused_seconds: expect.any(Number),
        }),
      );
    });
  });

  describe("registrarPrimeiraRespostaOutbound", () => {
    it("ignora mensagens com sent_via = system", async () => {
      const client = {
        from: vi.fn(),
      } as unknown as SupabaseClient;

      await registrarPrimeiraRespostaOutbound(CONV_1, "system" as unknown as "user", client);
      expect(client.from).not.toHaveBeenCalled();
    });

    it("grava primeira_resposta_em quando sent_via é user", async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const client = {
        from: vi.fn((table: string) => {
          if (table === "demanda_conversas") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      demanda_id: DEMANDA_ID,
                      demandas: {
                        id: DEMANDA_ID,
                        organization_id: ORG,
                        aberta_em: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
                        primeira_resposta_em: null,
                        sla_first_response_target_minutes: 60,
                        sla_total_paused_seconds: 0,
                      },
                    },
                  ],
                }),
              }),
            };
          }
          if (table === "demandas") {
            return { update: mockUpdate };
          }
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [] }),
            }),
          };
        }),
      } as unknown as SupabaseClient;

      await registrarPrimeiraRespostaOutbound(CONV_1, "user", client);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          primeira_resposta_em: expect.any(String),
          sla_first_response_breached: false,
        }),
      );
    });
  });
});
