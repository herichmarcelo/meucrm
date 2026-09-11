/**
 * lib/csat/types.ts — Tipos do motor de CSAT (Customer Satisfaction Score).
 */

export interface CsatSurvey {
  id: string;
  organization_id: string;
  demanda_id: string | null;
  conversation_id: string | null;
  contact_id: string;
  channel: "whatsapp" | "email";
  score: number | null;
  comment: string | null;
  token: string;
  status: "pending" | "completed" | "expired";
  sent_at: string;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CsatConfig {
  id: string;
  organization_id: string;
  tag_id: string | null;
  delay_minutes: number;
  max_frequency_days: number;
  created_at: string;
  updated_at: string;
}

export interface DispatchCsatInput {
  organizationId: string;
  conversationId: string;
  demandaId?: string | null;
  actorUserId?: string | null;
}

export interface DispatchCsatResult {
  dispatched: boolean;
  surveyId?: string;
  channel?: "whatsapp" | "email";
  reason?: string;
}

export interface ProcessCsatReplyInput {
  organizationId: string;
  conversationId: string;
  contactId: string;
  text: string;
}

export interface ProcessCsatReplyResult {
  handled: boolean;
  score?: number;
  surveyId?: string;
}
