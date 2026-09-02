import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/contacts/[id]/avatar/sync/route";
import type { SyncAvatarResult } from "@/lib/contacts/avatar-sync";

const CONTATO_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

let syncResultMock: SyncAvatarResult = {
  success: true,
  reason: "success",
  path: `${ORG_ID}/avatars/${CONTATO_ID}.jpg`,
  error: undefined,
};

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({
    ok: true,
    user: { id: "user-123" },
    org: { orgId: ORG_ID },
  })),
}));

vi.mock("@/lib/contacts/avatar-sync", () => ({
  syncContactAvatar: vi.fn(async () => syncResultMock),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.test/signed/${path}?token=abc` },
          error: null,
        }),
      }),
    },
  }),
}));

beforeEach(() => {
  syncResultMock = {
    success: true,
    reason: "success",
    path: `${ORG_ID}/avatars/${CONTATO_ID}.jpg`,
    error: undefined,
  };
});

describe("POST /api/v1/contacts/[id]/avatar/sync", () => {
  it("retorna 200 com avatar_storage_path e avatar_url em caso de sucesso", async () => {
    const req = new Request(`http://localhost/api/v1/contacts/${CONTATO_ID}/avatar/sync`, {
      method: "POST",
    });

    const res = await POST(req as never, { params: Promise.resolve({ id: CONTATO_ID }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toMatchObject({
      synced: true,
      reason: "success",
      avatar_storage_path: `${ORG_ID}/avatars/${CONTATO_ID}.jpg`,
      avatar_url: `https://storage.test/signed/${ORG_ID}/avatars/${CONTATO_ID}.jpg?token=abc`,
    });
  });

  it("retorna 200 com synced=false quando contato não tem foto pública", async () => {
    syncResultMock = {
      success: false,
      reason: "no_picture",
      path: null,
      error: undefined,
    };

    const req = new Request(`http://localhost/api/v1/contacts/${CONTATO_ID}/avatar/sync`, {
      method: "POST",
    });

    const res = await POST(req as never, { params: Promise.resolve({ id: CONTATO_ID }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toMatchObject({
      synced: false,
      reason: "no_picture",
      avatar_url: null,
    });
  });

  it("retorna 404 quando contato não existe", async () => {
    syncResultMock = {
      success: false,
      reason: "contact_not_found",
      path: null,
      error: undefined,
    };

    const req = new Request(`http://localhost/api/v1/contacts/${CONTATO_ID}/avatar/sync`, {
      method: "POST",
    });

    const res = await POST(req as never, { params: Promise.resolve({ id: CONTATO_ID }) });
    expect(res.status).toBe(404);
  });
});
