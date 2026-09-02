import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncContactAvatar } from "@/lib/contacts/avatar-sync";

const CONTATO_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const EXPECTED_PATH = `${ORG_ID}/avatars/${CONTATO_ID}.jpg`;

let mockContact: {
  id: string;
  organization_id: string;
  wa_identity: string | null;
  phone_number: string | null;
  is_anonymized: boolean;
} | null = null;

let mockSession: {
  provider: string;
  waha_session_name?: string;
  gowa_device_id?: string;
  status: string;
} | null = null;

let mockUpdateResult: { id: string }[] = [{ id: CONTATO_ID }];
const uploadedFiles: { path: string; buffer: Buffer; options: Record<string, unknown> }[] = [];
const redactionQueueUpserts: Record<string, unknown>[] = [];
let mockFetchPictureUrl: ((input: unknown) => Promise<string | null>) = async () => "https://pps.whatsapp.net/v/test.jpg";

vi.mock("@/lib/env", () => ({
  env: {
    INTERNAL_CRON_SECRET: "cron-secret",
    INTERNAL_SECRET: "internal-secret",
    GOWA_API_BASE_URL: "http://gowa.test:4000",
    GOWA_API_USER: "admin",
    GOWA_API_PASS: "secret123",
  },
}));

vi.mock("@/lib/channels", () => ({
  DEFAULT_CHANNEL_PROVIDER: "waha",
  getAdapter: (provider: string) => ({
    provider,
    fetchProfilePictureUrl: (input: unknown) => mockFetchPictureUrl(input),
  }),
}));

const mockAdminClient = {
  from: (table: string) => ({
    select: () => {
      const data = table === "contacts" ? mockContact : mockSession;
      return {
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data, error: null }),
            limit: () => ({
              maybeSingle: async () => ({ data, error: null }),
            }),
          }),
          maybeSingle: async () => ({ data, error: null }),
        }),
      };
    },
    update: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            select: async () => ({ data: mockUpdateResult, error: null }),
          }),
        }),
      }),
    }),
    upsert: async (payload: Record<string, unknown>) => {
      redactionQueueUpserts.push(payload);
      return { error: null };
    },
  }),
  storage: {
    from: () => ({
      upload: async (path: string, buffer: Buffer, options: Record<string, unknown>) => {
        uploadedFiles.push({ path, buffer, options });
        return { error: null };
      },
    }),
  },
};

beforeEach(() => {
  uploadedFiles.length = 0;
  redactionQueueUpserts.length = 0;
  mockUpdateResult = [{ id: CONTATO_ID }];
  mockContact = {
    id: CONTATO_ID,
    organization_id: ORG_ID,
    wa_identity: "phone:+5511999998888",
    phone_number: "+55 11 99999-8888",
    is_anonymized: false,
  };
  mockSession = {
    provider: "waha",
    waha_session_name: "org_test_vendas",
    status: "WORKING",
  };
  mockFetchPictureUrl = async () => "https://pps.whatsapp.net/v/test.jpg";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200 })),
  );
});

describe("syncContactAvatar — Serviço de Sincronização", () => {
  it("sincroniza foto de perfil com sucesso via WAHA", async () => {
    const res = await syncContactAvatar({
      organizationId: ORG_ID,
      contactId: CONTATO_ID,
      adminClient: mockAdminClient as never,
    });

    expect(res.success).toBe(true);
    expect(res.reason).toBe("success");
    expect(res.path).toBe(EXPECTED_PATH);
    expect(uploadedFiles).toHaveLength(1);
    expect(uploadedFiles[0]?.path).toBe(EXPECTED_PATH);
  });

  it("sincroniza foto de perfil com sucesso via GOWA", async () => {
    mockSession = {
      provider: "gowa",
      gowa_device_id: "gowa_device_vendas",
      status: "WORKING",
    };

    const res = await syncContactAvatar({
      organizationId: ORG_ID,
      contactId: CONTATO_ID,
      adminClient: mockAdminClient as never,
    });

    expect(res.success).toBe(true);
    expect(res.reason).toBe("success");
    expect(res.path).toBe(EXPECTED_PATH);
    expect(uploadedFiles).toHaveLength(1);
  });

  it("retorna no_picture quando o contato não tem foto pública", async () => {
    mockFetchPictureUrl = async () => null;

    const res = await syncContactAvatar({
      organizationId: ORG_ID,
      contactId: CONTATO_ID,
      adminClient: mockAdminClient as never,
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe("no_picture");
    expect(uploadedFiles).toHaveLength(0);
  });

  it("retorna anonymized e não baixa foto se contato já estiver anonimizado", async () => {
    mockContact!.is_anonymized = true;

    const res = await syncContactAvatar({
      organizationId: ORG_ID,
      contactId: CONTATO_ID,
      adminClient: mockAdminClient as never,
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe("anonymized");
    expect(uploadedFiles).toHaveLength(0);
  });

  it("trata condição de corrida LGPD: se anonimizado durante o upload, reverte arquivo para storage_redaction_queue", async () => {
    mockUpdateResult = []; // Simula contato anonimizado antes do UPDATE

    const res = await syncContactAvatar({
      organizationId: ORG_ID,
      contactId: CONTATO_ID,
      adminClient: mockAdminClient as never,
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe("anonymized");
    expect(uploadedFiles).toHaveLength(1);
    expect(redactionQueueUpserts).toHaveLength(1);
    expect(redactionQueueUpserts[0]).toMatchObject({
      organization_id: ORG_ID,
      bucket: "whatsapp-media",
      object_path: EXPECTED_PATH,
      status: "pending",
    });
  });
});
