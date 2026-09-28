import { randomUUID } from "node:crypto";

import type { Message, MessageStatus } from "@/types/database";

/**
 * In-memory model of the scheduler RPCs.
 *
 * It reimplements the CONTRACT that supabase/migrations/..._scheduler_rpc.sql
 * establishes — one claim per message, token-gated transitions, bounded
 * retries, monotonic webhook statuses — so the TypeScript that depends
 * on those guarantees can be tested without a live Postgres.
 *
 * What it does NOT prove is that Postgres honours the contract under
 * real concurrency; FOR UPDATE SKIP LOCKED does that, and verifying it
 * requires an actual database (see docs/TESTING.md).
 */

const STATUS_RANK: Record<MessageStatus, number> = {
  draft: 0,
  scheduled: 1,
  processing: 2,
  sent: 3,
  delivered: 4,
  read: 5,
  failed: 6,
  cancelled: 7,
};

export interface FakeEvent {
  message_id: string;
  event_type: string;
  actor: string;
  payload: Record<string, unknown>;
}

export class FakeDb {
  messages = new Map<string, Message>();
  events: FakeEvent[] = [];

  insertMessage(partial: Partial<Message> = {}): Message {
    const now = new Date().toISOString();

    const message: Message = {
      id: partial.id ?? randomUUID(),
      organization_id: partial.organization_id ?? "org-1",
      contact_id: partial.contact_id ?? null,
      phone: partial.phone ?? "+529981234567",
      // `?? ` would swallow an explicit null, which is exactly the case
      // the "no sendable content" test needs to construct.
      body: "body" in partial ? (partial.body ?? null) : "Hola",
      message_type: partial.message_type ?? "text",
      template_name: partial.template_name ?? null,
      template_language: partial.template_language ?? null,
      template_variables: partial.template_variables ?? {},
      scheduled_at: partial.scheduled_at ?? now,
      timezone: partial.timezone ?? "America/Cancun",
      status: partial.status ?? "scheduled",
      provider: "whatsapp_cloud",
      provider_message_id: partial.provider_message_id ?? null,
      processing_at: null,
      sent_at: null,
      delivered_at: null,
      read_at: null,
      failed_at: null,
      cancelled_at: null,
      error_code: null,
      error_message: null,
      attempt_count: partial.attempt_count ?? 0,
      max_attempts: partial.max_attempts ?? 3,
      last_attempt_at: null,
      claim_token: null,
      claimed_at: null,
      idempotency_key: partial.idempotency_key ?? randomUUID(),
      created_by: null,
      metadata: {},
      created_at: now,
      updated_at: now,
    };

    this.messages.set(message.id, message);
    return message;
  }

  private log(messageId: string, type: string, actor: string, payload: Record<string, unknown> = {}) {
    this.events.push({ message_id: messageId, event_type: type, actor, payload });
  }

  eventsFor(messageId: string) {
    return this.events.filter((e) => e.message_id === messageId);
  }

  // --- RPC implementations -------------------------------------------

  claim_due_messages({ p_limit = 25, p_worker = "n8n" }) {
    const now = Date.now();

    const due = [...this.messages.values()]
      .filter(
        (m) =>
          m.status === "scheduled" &&
          m.scheduled_at !== null &&
          new Date(m.scheduled_at).getTime() <= now &&
          m.attempt_count < m.max_attempts,
      )
      .sort(
        (a, b) =>
          new Date(a.scheduled_at!).getTime() -
          new Date(b.scheduled_at!).getTime(),
      )
      .slice(0, p_limit);

    return due.map((message) => {
      message.status = "processing";
      message.claim_token = randomUUID();
      message.claimed_at = new Date().toISOString();
      message.processing_at = message.claimed_at;
      message.attempt_count += 1;
      message.last_attempt_at = message.claimed_at;

      this.log(message.id, "message_processing", p_worker, {
        attempt: message.attempt_count,
      });

      return {
        id: message.id,
        organization_id: message.organization_id,
        contact_id: message.contact_id,
        phone: message.phone,
        body: message.body,
        message_type: message.message_type,
        template_name: message.template_name,
        template_language: message.template_language,
        template_variables: message.template_variables,
        claim_token: message.claim_token,
        attempt_count: message.attempt_count,
        max_attempts: message.max_attempts,
        scheduled_at: message.scheduled_at,
      };
    });
  }

  claim_message_by_id({ p_message_id, p_worker = "app" }: { p_message_id: string; p_worker?: string }) {
    const message = this.messages.get(p_message_id);

    if (
      !message ||
      message.status !== "scheduled" ||
      message.attempt_count >= message.max_attempts
    ) {
      return [];
    }

    message.status = "processing";
    message.claim_token = randomUUID();
    message.claimed_at = new Date().toISOString();
    message.attempt_count += 1;

    this.log(message.id, "message_processing", p_worker, {
      attempt: message.attempt_count,
    });

    return [
      {
        id: message.id,
        organization_id: message.organization_id,
        phone: message.phone,
        body: message.body,
        message_type: message.message_type,
        template_name: message.template_name,
        template_language: message.template_language,
        template_variables: message.template_variables,
        claim_token: message.claim_token,
        attempt_count: message.attempt_count,
        max_attempts: message.max_attempts,
      },
    ];
  }

  mark_message_sent({
    p_message_id,
    p_claim_token,
    p_provider_message_id,
    p_actor = "n8n",
  }: {
    p_message_id: string;
    p_claim_token: string;
    p_provider_message_id: string;
    p_actor?: string;
  }) {
    const message = this.messages.get(p_message_id);

    if (
      !message ||
      message.status !== "processing" ||
      message.claim_token !== p_claim_token
    ) {
      return false;
    }

    message.status = "sent";
    message.sent_at = new Date().toISOString();
    message.provider_message_id = p_provider_message_id;
    message.claim_token = null;
    message.error_code = null;
    message.error_message = null;

    this.log(message.id, "message_sent", p_actor, {
      provider_message_id: p_provider_message_id,
    });

    return true;
  }

  mark_message_failed({
    p_message_id,
    p_claim_token,
    p_error_code,
    p_error_message,
    p_retryable = true,
    p_actor = "n8n",
  }: {
    p_message_id: string;
    p_claim_token: string;
    p_error_code: string;
    p_error_message: string;
    p_retryable?: boolean;
    p_actor?: string;
  }) {
    const message = this.messages.get(p_message_id);

    if (
      !message ||
      message.status !== "processing" ||
      message.claim_token !== p_claim_token
    ) {
      return [{ final_status: null, will_retry: false }];
    }

    const willRetry = p_retryable && message.attempt_count < message.max_attempts;

    message.claim_token = null;
    message.error_code = p_error_code;
    message.error_message = p_error_message;

    if (willRetry) {
      const backoffMinutes = Math.min(
        30,
        2 ** Math.max(message.attempt_count - 1, 0),
      );
      message.status = "scheduled";
      message.scheduled_at = new Date(
        Date.now() + backoffMinutes * 60_000,
      ).toISOString();
      message.processing_at = null;
      message.claimed_at = null;

      this.log(message.id, "message_retry_scheduled", p_actor, {
        retry_in_minutes: backoffMinutes,
      });

      return [{ final_status: "scheduled", will_retry: true }];
    }

    message.status = "failed";
    message.failed_at = new Date().toISOString();
    this.log(message.id, "message_failed", p_actor, { error_code: p_error_code });

    return [{ final_status: "failed", will_retry: false }];
  }

  release_stuck_messages({ p_stale_minutes = 15 }) {
    const cutoff = Date.now() - p_stale_minutes * 60_000;
    let released = 0;

    for (const message of this.messages.values()) {
      if (
        message.status !== "processing" ||
        !message.claimed_at ||
        new Date(message.claimed_at).getTime() >= cutoff
      ) {
        continue;
      }

      message.status =
        message.attempt_count < message.max_attempts ? "scheduled" : "failed";
      if (message.status === "scheduled") {
        message.scheduled_at = new Date().toISOString();
      } else {
        message.failed_at = new Date().toISOString();
      }
      message.error_code ??= "worker_timeout";
      message.claim_token = null;
      message.claimed_at = null;

      this.log(message.id, "message_claim_released", "system", {
        new_status: message.status,
      });
      released += 1;
    }

    return released;
  }

  apply_provider_status({
    p_provider_message_id,
    p_status,
    p_occurred_at,
    p_error_code,
    p_error_message,
  }: {
    p_provider_message_id: string;
    p_status: string;
    p_occurred_at?: string;
    p_error_code?: string | null;
    p_error_message?: string | null;
  }) {
    const next = (
      { sent: "sent", delivered: "delivered", read: "read", failed: "failed" } as const
    )[p_status.toLowerCase() as "sent" | "delivered" | "read" | "failed"];

    if (!next) return false;

    const message = [...this.messages.values()].find(
      (m) => m.provider_message_id === p_provider_message_id,
    );
    if (!message) return false;

    if (next !== "failed" && STATUS_RANK[next] <= STATUS_RANK[message.status]) {
      return false;
    }
    if (next === "failed" && message.status === "failed") return false;

    const at = p_occurred_at ?? new Date().toISOString();
    message.status = next;

    if (next === "sent") message.sent_at ??= at;
    if (next === "delivered") message.delivered_at ??= at;
    if (next === "read") message.read_at ??= at;
    if (next === "failed") {
      message.failed_at ??= at;
      message.error_code = p_error_code ?? null;
      message.error_message = p_error_message ?? null;
    }

    this.log(message.id, `message_${next}`, "webhook", {});
    return true;
  }

  log_message_event({
    p_message_id,
    p_event_type,
    p_actor = "system",
    p_payload = {},
  }: {
    p_message_id: string;
    p_event_type: string;
    p_actor?: string;
    p_payload?: Record<string, unknown>;
  }) {
    this.log(p_message_id, p_event_type, p_actor, p_payload);
    return null;
  }

  /** Mimics supabase-js: client.rpc(name, args). */
  asSupabaseClient() {
    return {
      rpc: async (name: string, args: Record<string, unknown> = {}) => {
        const fn = (this as unknown as Record<string, unknown>)[name];
        if (typeof fn !== "function") {
          return { data: null, error: { message: `unknown rpc ${name}` } };
        }
        try {
          const data = (fn as (a: unknown) => unknown).call(this, args);
          return { data, error: null };
        } catch (error) {
          return {
            data: null,
            error: { message: (error as Error).message },
          };
        }
      },
    };
  }
}
