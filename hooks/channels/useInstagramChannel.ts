"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

export interface InstagramChannelState {
  connected: boolean;
  id?: string;
  account_id?: string | null;
  page_id?: string | null;
  username?: string | null;
  display_name?: string | null;
  status?: string | null;
  webhook_url?: string | null;
  channel_webhook_url?: string | null;
  verify_token?: string | null;
}

export interface ConnectInstagramInput {
  account_id: string;
  token: string;
  page_id?: string;
}

export function useInstagramChannel() {
  return useQuery({
    queryKey: ["instagram-channel"],
    queryFn: async () =>
      apiClient.get<{ data: InstagramChannelState }>("/api/v1/channels/instagram"),
    staleTime: 15_000,
  });
}

export function useConnectInstagramChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ConnectInstagramInput) =>
      apiClient.post<{ data: InstagramChannelState }>(
        "/api/v1/channels/instagram",
        input,
      ),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instagram-channel"] });
      qc.invalidateQueries({ queryKey: ["channel-sessions"] });
    },
  });
}

export function useDisconnectInstagramChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      apiClient.delete<{ data: { success: boolean } }>("/api/v1/channels/instagram"),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instagram-channel"] });
      qc.invalidateQueries({ queryKey: ["channel-sessions"] });
    },
  });
}
