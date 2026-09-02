import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getScheduled, POST as createScheduled } from "@/app/api/v1/contacts/[id]/scheduled-messages/route";
import { PATCH as updateScheduled, DELETE as cancelScheduled } from "@/app/api/v1/scheduled-messages/[id]/route";

const ORG_ID = "org-test-123";
const CONTACT_ID = "contact-test-123";
const MSG_ID = "msg-test-123";

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({
    ok: true,
    org: { orgId: ORG_ID, role: "agent" },
    user: { id: "user-test-123" },
  }),
}));

vi.mock("@/lib/audit", () => ({
  audit: async () => {},
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "contacts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: CONTACT_ID, is_anonymized: false, is_blocked: false },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "scheduled_messages") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    { id: MSG_ID, raw_body: "Teste", scheduled_for: "2026-09-02T15:00:00Z", status: "pending" },
                  ],
                  error: null,
                }),
                maybeSingle: async () => ({
                  data: { id: MSG_ID, status: "pending", scheduled_for: "2026-09-02T15:00:00Z", raw_body: "Teste" },
                  error: null,
                }),
              }),
            }),
          }),
          insert: (data: Record<string, unknown> | Record<string, unknown>[]) => ({
            select: async () => {
              const rows = Array.isArray(data)
                ? data.map((d, i) => ({ id: `${MSG_ID}-${i}`, ...d }))
                : [{ id: MSG_ID, ...data }];
              return { data: rows, error: null };
            },
          }),
          update: (data: Record<string, unknown>) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({ data: { id: MSG_ID, ...data }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    },
  }),
}));

describe("API — /api/v1/contacts/{id}/scheduled-messages & /api/v1/scheduled-messages/{id}", () => {
  it("GET /contacts/{id}/scheduled-messages retorna lista de agendamentos", async () => {
    const req = new NextRequest(`http://localhost/api/v1/contacts/${CONTACT_ID}/scheduled-messages`);
    const res = await getScheduled(req, { params: Promise.resolve({ id: CONTACT_ID }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe(MSG_ID);
  });

  it("POST /contacts/{id}/scheduled-messages cria novo agendamento com data no futuro", async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const req = new NextRequest(`http://localhost/api/v1/contacts/${CONTACT_ID}/scheduled-messages`, {
      method: "POST",
      body: JSON.stringify({
        raw_body: "Olá {nome}, seu horário é {hora}.",
        scheduled_for: futureDate,
      }),
    });

    const res = await createScheduled(req, { params: Promise.resolve({ id: CONTACT_ID }) });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.raw_body).toBe("Olá {nome}, seu horário é {hora}.");
    expect(json.data.status).toBe("pending");
  });

  it("POST /contacts/{id}/scheduled-messages aceita criação em lote (Batch Create)", async () => {
    const d1 = new Date(Date.now() + 3600000).toISOString();
    const d2 = new Date(Date.now() + 7200000).toISOString();
    const req = new NextRequest(`http://localhost/api/v1/contacts/${CONTACT_ID}/scheduled-messages`, {
      method: "POST",
      body: JSON.stringify([
        { raw_body: "Lembrete 1", scheduled_for: d1 },
        { raw_body: "Lembrete 2", scheduled_for: d2 },
      ]),
    });

    const res = await createScheduled(req, { params: Promise.resolve({ id: CONTACT_ID }) });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(2);
  });

  it("POST recusa agendamento no passado com 422", async () => {
    const pastDate = new Date(Date.now() - 3600000).toISOString();
    const req = new NextRequest(`http://localhost/api/v1/contacts/${CONTACT_ID}/scheduled-messages`, {
      method: "POST",
      body: JSON.stringify({
        raw_body: "Mensagem no passado",
        scheduled_for: pastDate,
      }),
    });

    const res = await createScheduled(req, { params: Promise.resolve({ id: CONTACT_ID }) });
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe("unprocessable_entity");
  });

  it("PATCH /scheduled-messages/{id} reagenda mensagem pendente", async () => {
    const futureDate = new Date(Date.now() + 7200000).toISOString();
    const req = new NextRequest(`http://localhost/api/v1/scheduled-messages/${MSG_ID}`, {
      method: "PATCH",
      body: JSON.stringify({
        scheduled_for: futureDate,
        raw_body: "Novo corpo da mensagem atualizado",
      }),
    });

    const res = await updateScheduled(req, { params: Promise.resolve({ id: MSG_ID }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.scheduled_for).toBe(futureDate);
  });

  it("DELETE /scheduled-messages/{id} cancela mensagem pendente", async () => {
    const req = new NextRequest(`http://localhost/api/v1/scheduled-messages/${MSG_ID}`, {
      method: "DELETE",
    });

    const res = await cancelScheduled(req, { params: Promise.resolve({ id: MSG_ID }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.cancelled).toBe(true);
  });
});
