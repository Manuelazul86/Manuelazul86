/**
 * Hand-written database types.
 *
 * Once the project is linked you can regenerate these with
 *   npx supabase gen types typescript --linked > src/types/database.ts
 * The shape below mirrors supabase/migrations exactly.
 */

export type MessageStatus =
  | "draft"
  | "scheduled"
  | "processing"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "cancelled";

export type MessageKind = "text" | "template";
export type OrgRole = "owner" | "admin" | "member";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  organization_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface Contact {
  id: string;
  organization_id: string;
  name: string;
  phone: string;
  email: string | null;
  company: string | null;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  organization_id: string;
  contact_id: string | null;
  phone: string;
  body: string | null;
  message_type: MessageKind;
  template_name: string | null;
  template_language: string | null;
  template_variables: Record<string, string>;
  scheduled_at: string | null;
  timezone: string;
  status: MessageStatus;
  provider: string;
  provider_message_id: string | null;
  processing_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number;
  max_attempts: number;
  last_attempt_at: string | null;
  claim_token: string | null;
  claimed_at: string | null;
  idempotency_key: string | null;
  created_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MessageWithContact extends Message {
  contact: Pick<Contact, "id" | "name" | "phone"> | null;
}

export interface MessageEvent {
  id: number;
  organization_id: string;
  message_id: string | null;
  event_type: string;
  actor: string;
  actor_user_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

/** Row shape returned by the claim_due_messages() RPC. */
export interface ClaimedMessage {
  id: string;
  organization_id: string;
  contact_id: string | null;
  phone: string;
  body: string | null;
  message_type: MessageKind;
  template_name: string | null;
  template_language: string | null;
  template_variables: Record<string, string>;
  claim_token: string;
  attempt_count: number;
  max_attempts: number;
  scheduled_at: string | null;
}
