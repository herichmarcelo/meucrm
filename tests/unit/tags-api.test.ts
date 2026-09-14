import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { GET, POST } from "@/app/api/v1/tags/route";
import type { AuthUser, Role } from "@/lib/auth/types";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
}));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

function mockAuthz(role: Role) {
  return {
    ok: true as const,
    user: { id: USER, email: "agent@example.com" } as unknown as AuthUser,
    org: { orgId: ORG, role, name: "Test Org", organization_name: "Test Org" },
  };
}

describe("API /api/v1/tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/v1/tags retorna tags da organização", async () => {
    vi.mocked(requireRole).mockResolvedValue(mockAuthz("viewer"));

    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockResolvedValue({
      data: [
        { id: "1", organization_id: ORG, name: "urgente", color: "vermelho" },
        { id: "2", organization_id: ORG, name: "dúvida", color: null },
      ],
      error: null,
    });

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: mockSelect,
        eq: mockEq,
        order: mockOrder,
      }),
    } as unknown as SupabaseClient);

    const req = new NextRequest("http://localhost/api/v1/tags");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].name).toBe("urgente");
    expect(body.data[0].color).toBe("vermelho");
  });

  it("POST /api/v1/tags cadastra/atualiza tag com cor e audita mutação", async () => {
    vi.mocked(requireRole).mockResolvedValue(mockAuthz("agent"));

    const mockUpsert = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnThis();
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: "tag-1",
        organization_id: ORG,
        name: "urgente",
        color: "vermelho",
      },
      error: null,
    });

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        upsert: mockUpsert,
        select: mockSelect,
        single: mockSingle,
      }),
    } as unknown as SupabaseClient);

    const req = new NextRequest("http://localhost/api/v1/tags", {
      method: "POST",
      body: JSON.stringify({ name: "Urgente", color: "vermelho" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.name).toBe("urgente");
    expect(body.data.color).toBe("vermelho");

    // Verifica que auditoria foi chamada
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        action: "tag.upserted",
        metadata: { name: "urgente", color: "vermelho" },
      }),
    );
  });

  it("POST /api/v1/tags rejeita payload inválido", async () => {
    vi.mocked(requireRole).mockResolvedValue(mockAuthz("agent"));

    const req = new NextRequest("http://localhost/api/v1/tags", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });
});
