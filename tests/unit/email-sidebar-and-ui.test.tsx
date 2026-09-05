import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { channelLabel } from "@/hooks/channels/useChannelSessions";
import { ConversationListItem } from "@/components/inbox/ConversationListItem";
import { ConversationHeader } from "@/components/inbox/ConversationHeader";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";

// Mocks
vi.mock("@/lib/tempo/TempoProvider", () => ({
  useTempo: () => ({
    formatarHora: (d: Date | string) => "10:30",
  }),
}));

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    activeOrg: { orgId: "org-1", role: "admin" },
  }),
}));

vi.mock("@/hooks/i18n/useT", () => ({
  useT: () => (s: string) => s,
}));

vi.mock("@/hooks/inbox/useClaimConversation", () => ({
  useClaimConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/inbox/useReleaseConversation", () => ({
  useReleaseConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/inbox/useCloseConversation", () => ({
  useCloseConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/inbox/useResumeAiAttendance", () => ({
  useResumeAiAttendance: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/inbox/useSnoozeConversation", () => ({
  useSnoozeConversation: () => ({
    snooze: { mutate: vi.fn(), isPending: false },
    cancel: { mutate: vi.fn(), isPending: false },
  }),
}));

describe("Email UI Presentation — channelLabel Helper", () => {
  it("channelLabel resolve email_inbound_address corretamente", () => {
    expect(
      channelLabel({
        display_name: null,
        phone_number: null,
        waha_session_name: null,
        email_inbound_address: "atendimento@loja.com.br",
        provider: "email",
      }),
    ).toBe("atendimento@loja.com.br");

    expect(
      channelLabel({
        display_name: "Suporte VIP",
        phone_number: null,
        waha_session_name: null,
        email_inbound_address: "suporte@loja.com.br",
        provider: "email",
      }),
    ).toBe("Suporte VIP");

    expect(
      channelLabel({
        display_name: null,
        phone_number: null,
        waha_session_name: null,
        email_inbound_address: null,
        provider: "email",
      }),
    ).toBe("Canal de E-mail");
  });
});

describe("Email UI Presentation — Components", () => {
  const baseConversation: ConversationWithContact = {
    id: "conv-email-1",
    organization_id: "org-1",
    contact_id: "contact-1",
    channel_session_id: "sess-email-1",
    channel: "email",
    status: "open",
    assigned_to_user_id: null,
    unread_count_for_assignee: 0,
    last_inbound_at: "2026-09-04T12:00:00Z",
    last_message_at: "2026-09-04T12:00:00Z",
    last_message_preview: "[Orçamento] Gostaria de contratar",
    created_at: "2026-09-04T12:00:00Z",
    updated_at: "2026-09-04T12:00:00Z",
    status_changed_at: "2026-09-04T12:00:00Z",
    assignee_kind: null,
    assigned_at: null,
    last_outbound_at: null,
    is_group: false,
    group_chat_id: null,
    tags: [],
    metadata: {},
    snooze_until: null,
    last_handoff_at: null,
    bot_silenced_until: null,
    contacts: {
      id: "contact-1",
      name: "João Cliente",
      display_name: "João Cliente",
      phone_number: null,
      email: "joao@cliente.com.br",
      is_blocked: false,
      is_anonymized: false,
      avatar_storage_path: null,
      tags: ["Orçamento"],
    },
    channel_sessions: {
      id: "sess-email-1",
      provider: "email",
      display_name: "Atendimento Geral",
      phone_number: null,
      email_inbound_address: "atendimento@empresa.com",
    },
  };

  it("ConversationListItem renderiza badge de canal de e-mail quando mostrarCanal=true", () => {
    render(
      <ConversationListItem
        conversation={baseConversation}
        isSelected={false}
        onSelect={vi.fn()}
        mostrarCanal={true}
      />,
    );

    expect(screen.getByText("João Cliente")).toBeDefined();
    expect(screen.getByText("atendimento@empresa.com")).toBeDefined();
  });

  it("ConversationHeader exibe e-mail do contato quando não há telefone", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ConversationHeader conversation={baseConversation} />
      </QueryClientProvider>,
    );

    expect(screen.getByText("João Cliente")).toBeDefined();
    expect(screen.getByText("joao@cliente.com.br")).toBeDefined();
  });
});
