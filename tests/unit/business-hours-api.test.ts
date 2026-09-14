import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { GET, PUT } from "@/app/api/v1/business-hours/route";
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
    user: { id: USER, email: "manager@example.com" } as unknown as AuthUser,
    org: { orgId: ORG, role, name: "Test Org", organization_name: "Test Org" },
  };
}

describe("API /api/v1/business-hours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET retorna slots e feriados da organização ativa", async () => {
    vi.mocked(requireRole).mockResolvedValue(mockAuthz("viewer"));

    const mockSelectSlots = vi.fn().mockReturnThis();
    const mockEqSlots = vi.fn().mockReturnThis();
    const mockOrderSlots = vi.fn().mockResolvedValue({
      data: [{ id: "slot-1", day_of_week: 1, open_time: "08:00:00", close_time: "18:00:00", is_active: true }],
      error: null,
    });

    const mockSelectHolidays = vi.fn().mockReturnThis();
    const mockEqHolidays = vi.fn().mockReturnThis();
    const mockOrderHolidays = vi.fn().mockResolvedValue({
      data: [{ id: "hol-1", holiday_date: "2026-12-25", description: "Natal" }],
      error: null,
    });

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "business_hours_slots") {
          return {
            select: mockSelectSlots,
            eq: mockEqSlots,
            order: mockOrderSlots,
          };
        }
        return {
          select: mockSelectHolidays,
          eq: mockEqHolidays,
          order: mockOrderHolidays,
        };
      }),
    } as unknown as SupabaseClient);

    const req = new NextRequest("http://localhost/api/v1/business-hours");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.slots).toHaveLength(1);
    expect(body.data.holidays).toHaveLength(1);
  });

  it("PUT atualiza slots e audita mutação quando role é manager", async () => {
    vi.mocked(requireRole).mockResolvedValue(mockAuthz("manager"));

    const mockUpsertSlots = vi.fn().mockReturnThis();
    const mockSelectSlots = vi.fn().mockResolvedValue({
      data: [
        {
          id: "slot-1",
          organization_id: ORG,
          day_of_week: 1,
          open_time: "09:00:00",
          close_time: "17:00:00",
          is_active: true,
          timezone: "America/Sao_Paulo",
        },
      ],
      error: null,
    });

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        upsert: mockUpsertSlots,
        select: mockSelectSlots,
      }),
    } as unknown as SupabaseClient);

    const req = new NextRequest("http://localhost/api/v1/business-hours", {
      method: "PUT",
      body: JSON.stringify({
        slots: [
          {
            day_of_week: 1,
            open_time: "09:00",
            close_time: "17:00",
            is_active: true,
            timezone: "America/Sao_Paulo",
          },
        ],
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.slots).toHaveLength(1);

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        action: "business_hours.updated",
        resourceType: "business_hours",
      }),
    );
  });

  it("PUT rejeita quando close_time <= open_time", async () => {
    vi.mocked(requireRole).mockResolvedValue(mockAuthz("manager"));

    const req = new NextRequest("http://localhost/api/v1/business-hours", {
      method: "PUT",
      body: JSON.stringify({
        slots: [
          {
            day_of_week: 1,
            open_time: "18:00",
            close_time: "08:00", // Invalido!
            is_active: true,
            timezone: "America/Sao_Paulo",
          },
        ],
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });
});
