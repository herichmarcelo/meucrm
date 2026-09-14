import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getCsatMetrics } from "@/app/api/v1/metrics/csat/route";
import { GET as getSlaMetrics } from "@/app/api/v1/metrics/sla/route";

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/sla/sla-tracking", () => ({
  resolverTipoAtendimentoDemanda: vi.fn(),
}));

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolverTipoAtendimentoDemanda } from "@/lib/sla/sla-tracking";

describe("SLA & CSAT Metrics API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/metrics/csat", () => {
    it("deve rejeitar se usuário não for manager", async () => {
      vi.mocked(requireRole).mockResolvedValueOnce({
        ok: false,
        response: new Response(JSON.stringify({ error: { code: "forbidden" } }), {
          status: 403,
        }),
      } as never);

      const req = new NextRequest("http://localhost/api/v1/metrics/csat");
      const res = await getCsatMetrics(req);
      expect(res.status).toBe(403);
    });

    it("deve calcular métricas de CSAT agregadas corretamente", async () => {
      vi.mocked(requireRole).mockResolvedValueOnce({
        ok: true,
        org: { orgId: "org-1", role: "manager" },
        user: { id: "user-1" },
      } as never);

      const mockSurveys = [
        {
          id: "s1",
          channel: "whatsapp",
          score: 5,
          comment: "Ótimo atendimento!",
          status: "completed",
          sent_at: new Date().toISOString(),
          responded_at: new Date().toISOString(),
        },
        {
          id: "s2",
          channel: "whatsapp",
          score: 4,
          comment: null,
          status: "completed",
          sent_at: new Date().toISOString(),
          responded_at: new Date().toISOString(),
        },
        {
          id: "s3",
          channel: "email",
          score: 1,
          comment: "Demorou demais",
          status: "completed",
          sent_at: new Date().toISOString(),
          responded_at: new Date().toISOString(),
        },
        {
          id: "s4",
          channel: "whatsapp",
          score: null,
          comment: null,
          status: "pending",
          sent_at: new Date().toISOString(),
          responded_at: null,
        },
      ];

      const mockAdmin = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockResolvedValue({ data: mockSurveys, error: null }),
        }),
      };

      vi.mocked(createAdminClient).mockReturnValue(mockAdmin as never);

      const req = new NextRequest("http://localhost/api/v1/metrics/csat?period=30d");
      const res = await getCsatMetrics(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.total_pesquisas_enviadas).toBe(4);
      expect(json.data.total_respostas).toBe(3);
      expect(json.data.taxa_resposta_pct).toBe(75); // 3/4 = 75%
      expect(json.data.media_csat).toBe(3.33); // (5 + 4 + 1) / 3 = 3.33
      expect(json.data.csat_score_pct).toBe(67); // 2 de 3 são >= 4 (66.6% -> 67%)
      expect(json.data.distribuicao_notas["5"]).toBe(1);
      expect(json.data.distribuicao_notas["4"]).toBe(1);
      expect(json.data.distribuicao_notas["1"]).toBe(1);
      expect(json.data.ultimos_comentarios).toHaveLength(2);
    });
  });

  describe("GET /api/v1/metrics/sla", () => {
    it("deve rejeitar se usuário não for manager", async () => {
      vi.mocked(requireRole).mockResolvedValueOnce({
        ok: false,
        response: new Response(JSON.stringify({ error: { code: "forbidden" } }), {
          status: 403,
        }),
      } as never);

      const req = new NextRequest("http://localhost/api/v1/metrics/sla");
      const res = await getSlaMetrics(req);
      expect(res.status).toBe(403);
    });

    it("deve retornar métricas de SLA calculadas", async () => {
      vi.mocked(requireRole).mockResolvedValueOnce({
        ok: true,
        org: { orgId: "org-1", role: "manager" },
        user: { id: "user-1" },
      } as never);

      const mockDemandas = [
        {
          id: "d1",
          estado: "resolvida",
          criada_em: "2026-09-11T10:00:00Z",
          fechada_em: "2026-09-11T12:00:00Z",
          primeira_resposta_em: "2026-09-11T10:15:00Z",
          sla_paused_at: null,
          sla_total_paused_seconds: 0,
        },
      ];

      const mockAdmin = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "business_hours_slots") {
            return {
              select: () => ({
                eq: () =>
                  Promise.resolve({
                    data: [
                      {
                        day_of_week: 5,
                        open_time: "09:00:00",
                        close_time: "18:00:00",
                        is_active: true,
                        timezone: "UTC",
                      },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          if (table === "business_holidays") {
            return {
              select: () => ({
                eq: () => Promise.resolve({ data: [], error: null }),
              }),
            };
          }
          if (table === "demandas") {
            return {
              select: () => ({
                eq: () => ({
                  gte: () => ({
                    lte: () => Promise.resolve({ data: mockDemandas, error: null }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      vi.mocked(resolverTipoAtendimentoDemanda).mockResolvedValue({
        tag_name: "Suporte",
        first_response_minutes: 30,
        resolution_minutes: 240,
        is_csat_enabled: true,
        first_conversation_id: "c1",
      });

      vi.mocked(createAdminClient).mockReturnValue(mockAdmin as never);

      const req = new NextRequest("http://localhost/api/v1/metrics/sla?period=7d");
      const res = await getSlaMetrics(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.total_demandas).toBe(1);
      expect(json.data.primeira_resposta.total_respondidas).toBe(1);
      expect(json.data.primeira_resposta.tempo_medio_minutos).toBe(15);
      expect(json.data.primeira_resposta.taxa_cumprimento_pct).toBe(100);
      expect(json.data.resolucao.total_resolvidas).toBe(1);
      expect(json.data.resolucao.tempo_medio_minutos).toBe(120);
      expect(json.data.resolucao.taxa_cumprimento_pct).toBe(100);
    });

    it("deve retornar lista viva de demandas em risco", async () => {
      vi.mocked(requireRole).mockResolvedValueOnce({
        ok: true,
        org: { orgId: "org-1", role: "viewer" },
        user: { id: "user-1" },
      } as never);

      const agora = new Date();
      const mockDemandas = [
        {
          id: "dem-risco-1",
          assunto: "Reclamação de atraso",
          estado: "aberta",
          criada_em: new Date(agora.getTime() - 120 * 60 * 1000).toISOString(),
          fechada_em: null,
          primeira_resposta_em: null,
          sla_paused_at: null,
          sla_total_paused_seconds: 0,
        },
      ];

      const mockAdmin = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "business_hours_slots") {
            return {
              select: () => ({
                eq: () =>
                  Promise.resolve({
                    data: [
                      {
                        day_of_week: agora.getDay(),
                        open_time: "00:00:00",
                        close_time: "23:59:59",
                        is_active: true,
                        timezone: "UTC",
                      },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          if (table === "business_holidays") {
            return {
              select: () => ({
                eq: () => Promise.resolve({ data: [], error: null }),
              }),
            };
          }
          if (table === "demandas") {
            return {
              select: () => ({
                eq: () => ({
                  gte: () => ({
                    lte: () => Promise.resolve({ data: mockDemandas, error: null }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      vi.mocked(resolverTipoAtendimentoDemanda).mockResolvedValue({
        tag_name: "Reclamação",
        first_response_minutes: 30,
        resolution_minutes: 240,
        is_csat_enabled: true,
        first_conversation_id: "conv-123",
      });

      vi.mocked(createAdminClient).mockReturnValue(mockAdmin as never);

      const req = new NextRequest("http://localhost/api/v1/metrics/sla?period=7d");
      const res = await getSlaMetrics(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.radar_risco.violado).toBe(1);
      expect(json.data.demandas_em_risco).toHaveLength(1);
      expect(json.data.demandas_em_risco[0]).toMatchObject({
        id: "dem-risco-1",
        assunto: "Reclamação de atraso",
        tipo: "Reclamação",
        bucket: "violado",
        conversation_id: "conv-123",
        primeira_resposta_pendente: true,
      });
    });
  });
});
