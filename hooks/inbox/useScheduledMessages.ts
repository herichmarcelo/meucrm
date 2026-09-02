"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { toast } from "sonner";

export type ScheduledMessageStatus = "pending" | "sent" | "failed" | "cancelled";

export interface ScheduledMessage {
  id: string;
  organization_id: string;
  contact_id: string;
  conversation_id: string | null;
  template_id: string | null;
  raw_body: string;
  scheduled_for: string;
  status: ScheduledMessageStatus;
  sent_at: string | null;
  cancelled_at: string | null;
  error_message: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  template?: { id: string; title: string } | null;
}

export interface CreateScheduledMessageArgs {
  contact_id: string;
  conversation_id?: string | null;
  template_id?: string | null;
  raw_body: string;
  scheduled_for: string; // ISO string
}

export interface BatchCreateScheduledMessageArgs {
  contact_id: string;
  items: Array<{
    conversation_id?: string | null;
    template_id?: string | null;
    raw_body: string;
    scheduled_for: string;
  }>;
}

export type CreateScheduledMessagePayload = CreateScheduledMessageArgs | BatchCreateScheduledMessageArgs;

export interface UpdateScheduledMessageArgs {
  id: string;
  contact_id: string;
  raw_body?: string;
  scheduled_for?: string;
}

export interface CancelScheduledMessageArgs {
  id: string;
  contact_id: string;
}

export function useScheduledMessages(contactId: string | null | undefined) {
  return useQuery({
    queryKey: ["scheduled-messages", contactId],
    queryFn: async () => {
      if (!contactId) return [];
      const res = await apiClient.get<{ data: ScheduledMessage[] }>(
        `/api/v1/contacts/${contactId}/scheduled-messages`,
      );
      return res.data ?? [];
    },
    enabled: !!contactId,
    staleTime: 10_000,
  });
}

export function useCreateScheduledMessage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateScheduledMessagePayload) => {
      const contactId = payload.contact_id;
      const body =
        "items" in payload
          ? payload.items
          : {
              raw_body: payload.raw_body,
              scheduled_for: payload.scheduled_for,
              conversation_id: payload.conversation_id,
              template_id: payload.template_id,
            };

      return apiClient.post<{ data: ScheduledMessage | ScheduledMessage[] }>(
        `/api/v1/contacts/${contactId}/scheduled-messages`,
        body,
      );
    },
    onSuccess: (_res, args) => {
      qc.invalidateQueries({ queryKey: ["scheduled-messages", args.contact_id] });
      const count = "items" in args ? args.items.length : 1;
      toast.success(
        count > 1
          ? `${count} mensagens/lembretes agendados com sucesso!`
          : "Mensagem agendada com sucesso!",
      );
    },
    onError: showApiError,
  });
}

export function useUpdateScheduledMessage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, raw_body, scheduled_for }: UpdateScheduledMessageArgs) =>
      apiClient.patch<{ data: ScheduledMessage }>(`/api/v1/scheduled-messages/${id}`, {
        raw_body,
        scheduled_for,
      }),
    onSuccess: (_res, args) => {
      qc.invalidateQueries({ queryKey: ["scheduled-messages", args.contact_id] });
      toast.success("Agendamento atualizado com sucesso!");
    },
    onError: showApiError,
  });
}

export function useCancelScheduledMessage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: CancelScheduledMessageArgs) =>
      apiClient.delete<{ data: { success: boolean; cancelled: boolean } }>(
        `/api/v1/scheduled-messages/${id}`,
      ),
    onSuccess: (_res, args) => {
      qc.invalidateQueries({ queryKey: ["scheduled-messages", args.contact_id] });
      toast.success("Mensagem agendada cancelada.");
    },
    onError: showApiError,
  });
}
