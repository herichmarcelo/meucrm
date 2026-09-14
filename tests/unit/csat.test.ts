import { describe, it, expect, vi, beforeEach } from "vitest";
import { extrairNotaCsat, processarRespostaCsat } from "@/lib/csat/csat-responder";
import { dispararPesquisaCsat } from "@/lib/csat/csat-dispatcher";
import { buildCsatEmail } from "@/lib/email/templates/csat";

describe("CSAT Unit Tests", () => {
  describe("extrairNotaCsat", () => {
    it("deve extrair notas de rowId da lista interativa (csat_1 a csat_5)", () => {
      expect(extrairNotaCsat("csat_1")).toBe(1);
      expect(extrairNotaCsat("csat_2")).toBe(2);
      expect(extrairNotaCsat("csat_3")).toBe(3);
      expect(extrairNotaCsat("csat_4")).toBe(4);
      expect(extrairNotaCsat("csat_5")).toBe(5);
      expect(extrairNotaCsat("CSAT_5")).toBe(5);
    });

    it("deve extrair notas de dígitos simples", () => {
      expect(extrairNotaCsat("1")).toBe(1);
      expect(extrairNotaCsat("3")).toBe(3);
      expect(extrairNotaCsat("5")).toBe(5);
      expect(extrairNotaCsat("0")).toBeNull();
      expect(extrairNotaCsat("6")).toBeNull();
    });

    it("deve extrair notas com palavras compostas", () => {
      expect(extrairNotaCsat("nota 5")).toBe(5);
      expect(extrairNotaCsat("5 estrelas")).toBe(5);
      expect(extrairNotaCsat("1 estrela")).toBe(1);
      expect(extrairNotaCsat("opcao 4")).toBe(4);
    });

    it("deve retornar null para texto livre ou não relacionado", () => {
      expect(extrairNotaCsat("Olá, gostaria de saber mais")).toBeNull();
      expect(extrairNotaCsat("sim")).toBeNull();
      expect(extrairNotaCsat("obrigado")).toBeNull();
    });
  });

  describe("buildCsatEmail", () => {
    it("deve gerar template HTML e texto com a marca e links das 5 notas", () => {
      const email = buildCsatEmail({
        clientName: "Maria Silva",
        surveyBaseUrl: "https://crm.exemplo.com/csat/v/token-123",
        marca: {
          nome: "Acme CRM",
          logoUrl: "https://crm.exemplo.com/logo.png",
          accent: "#2563eb",
          accentFg: "#ffffff",
          origens: { nome: "padrao", cor: "padrao" },
        },
      });

      expect(email.subject).toContain("Acme CRM");
      expect(email.html).toContain("Olá, Maria Silva!");
      expect(email.html).toContain("https://crm.exemplo.com/csat/v/token-123?score=1");
      expect(email.html).toContain("https://crm.exemplo.com/csat/v/token-123?score=5");
      expect(email.html).toContain("#2563eb");
      expect(email.text).toContain("https://crm.exemplo.com/csat/v/token-123?score=5");
    });
  });

  describe("dispararPesquisaCsat", () => {
    const mockAdmin = {
      from: vi.fn(),
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("não deve disparar se conversa não tiver tags habilitadas para CSAT", async () => {
      mockAdmin.from.mockImplementation((table: string) => {
        if (table === "conversations") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "conv-1",
                      tags: ["Dúvida Geral"],
                      channel_session_id: "sess-1",
                      contact_id: "cont-1",
                      status: "closed",
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "tags_definitions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: null, // sem tag habilitada
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      const res = await dispararPesquisaCsat(
        {
          organizationId: "org-1",
          conversationId: "conv-1",
        },
        mockAdmin as never,
      );

      expect(res.dispatched).toBe(false);
      expect(res.reason).toBe("csat_not_enabled_for_tag");
    });

    it("não deve disparar se já existir pesquisa para a mesma conversa", async () => {
      mockAdmin.from.mockImplementation((table: string) => {
        if (table === "conversations") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "conv-1",
                      tags: ["Suporte"],
                      channel_session_id: "sess-1",
                      contact_id: "cont-1",
                      status: "closed",
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "tags_definitions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: { id: "tag-1", name: "Suporte", is_csat_enabled: true },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "csat_surveys") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: "survey-existente" },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      const res = await dispararPesquisaCsat(
        {
          organizationId: "org-1",
          conversationId: "conv-1",
        },
        mockAdmin as never,
      );

      expect(res.dispatched).toBe(false);
      expect(res.reason).toBe("survey_already_dispatched");
    });

    it("não deve disparar se o contato já recebeu pesquisa recentemente (limite de frequência)", async () => {
      mockAdmin.from.mockImplementation((table: string) => {
        if (table === "conversations") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "conv-2",
                      tags: ["Suporte"],
                      channel_session_id: "sess-1",
                      contact_id: "cont-1",
                      status: "closed",
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "tags" || table === "tags_definitions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: { id: "tag-1", name: "Suporte", is_csat_enabled: true },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "csat_config") {
          return {
            select: () => ({
              eq: async () => ({
                data: [{ tag_id: "tag-1", delay_minutes: 0, max_frequency_days: 30 }],
                error: null,
              }),
            }),
          };
        }
        if (table === "csat_surveys") {
          return {
            select: () => ({
              eq: (_field1: string) => ({
                eq: (field2: string) => {
                  if (field2 === "conversation_id") {
                    // Sem pesquisa anterior nesta conversa
                    return { maybeSingle: async () => ({ data: null, error: null }) };
                  }
                  // contact_id: possui pesquisa recente no intervalo
                  return {
                    gte: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({
                          data: { id: "survey-recente-contato" },
                          error: null,
                        }),
                      }),
                    }),
                  };
                },
              }),
            }),
          };
        }
        return {};
      });

      const res = await dispararPesquisaCsat(
        {
          organizationId: "org-1",
          conversationId: "conv-2",
        },
        mockAdmin as never,
      );

      expect(res.dispatched).toBe(false);
      expect(res.reason).toBe("contact_frequency_limit_exceeded");
    });
  });


  describe("processarRespostaCsat", () => {
    it("deve retornar handled: false se texto não for nota", async () => {
      const res = await processarRespostaCsat({
        organizationId: "org-1",
        conversationId: "conv-1",
        contactId: "cont-1",
        text: "bom dia tudo bem",
      });
      expect(res.handled).toBe(false);
    });
  });
});
