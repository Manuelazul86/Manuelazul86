import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeDb } from "./helpers/fake-db";

const db = new FakeDb();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => db.asSupabaseClient(),
}));

const { dispatchClaimedMessage } = await import("@/services/messages/dispatch");

beforeEach(() => {
  db.messages.clear();
  db.events.length = 0;
});

describe("atomic claim", () => {
  it("moves a due message from scheduled to processing and issues a token", () => {
    const message = db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    });

    const claimed = db.claim_due_messages({ p_limit: 10, p_worker: "n8n" });

    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(message.id);
    expect(claimed[0].claim_token).toBeTruthy();
    expect(db.messages.get(message.id)!.status).toBe("processing");
    expect(db.messages.get(message.id)!.attempt_count).toBe(1);
  });

  it("hands a message to exactly one caller, never two", () => {
    db.insertMessage({ scheduled_at: new Date(Date.now() - 1000).toISOString() });

    const first = db.claim_due_messages({ p_limit: 10, p_worker: "worker-a" });
    const second = db.claim_due_messages({ p_limit: 10, p_worker: "worker-b" });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("ignores messages whose time has not arrived", () => {
    db.insertMessage({
      scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    expect(db.claim_due_messages({ p_limit: 10 })).toHaveLength(0);
  });

  it("ignores cancelled messages even when their time has passed", () => {
    db.insertMessage({
      status: "cancelled",
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    });

    expect(db.claim_due_messages({ p_limit: 10 })).toHaveLength(0);
  });

  it("respects the batch limit", () => {
    for (let i = 0; i < 5; i += 1) {
      db.insertMessage({ scheduled_at: new Date(Date.now() - 1000).toISOString() });
    }

    expect(db.claim_due_messages({ p_limit: 2 })).toHaveLength(2);
  });

  it("will not claim a message that has exhausted its attempts", () => {
    db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
      attempt_count: 3,
      max_attempts: 3,
    });

    expect(db.claim_due_messages({ p_limit: 10 })).toHaveLength(0);
  });

  it("records an audit event for every claim", () => {
    const message = db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    });

    db.claim_due_messages({ p_limit: 10 });

    expect(
      db.eventsFor(message.id).map((e) => e.event_type),
    ).toContain("message_processing");
  });
});

describe("double-send protection", () => {
  it("rejects a confirmation carrying a stale token", () => {
    const message = db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    });

    const [claimed] = db.claim_due_messages({ p_limit: 1 });

    expect(
      db.mark_message_sent({
        p_message_id: message.id,
        p_claim_token: claimed.claim_token,
        p_provider_message_id: "wamid.PRIMERO",
      }),
    ).toBe(true);

    // A replayed worker presenting the same, now-consumed token.
    expect(
      db.mark_message_sent({
        p_message_id: message.id,
        p_claim_token: claimed.claim_token,
        p_provider_message_id: "wamid.SEGUNDO",
      }),
    ).toBe(false);

    // The first provider id stands; the replay changed nothing.
    expect(db.messages.get(message.id)!.provider_message_id).toBe(
      "wamid.PRIMERO",
    );
  });

  it("rejects a confirmation from a worker that never held the claim", () => {
    const message = db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    });

    db.claim_due_messages({ p_limit: 1 });

    expect(
      db.mark_message_sent({
        p_message_id: message.id,
        p_claim_token: "00000000-0000-4000-8000-000000000000",
        p_provider_message_id: "wamid.INTRUSO",
      }),
    ).toBe(false);

    expect(db.messages.get(message.id)!.status).toBe("processing");
  });

  it("dispatches a claimed message exactly once even when called twice", async () => {
    const message = db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    });

    const [claimed] = db.claim_due_messages({ p_limit: 1 });

    const first = await dispatchClaimedMessage(
      claimed,
      "n8n",
    );
    const second = await dispatchClaimedMessage(
      claimed,
      "n8n",
    );

    expect(first.status).toBe("sent");
    expect(second.status).toBe("sent");

    // Only the first dispatch actually transitioned the row.
    const sentEvents = db
      .eventsFor(message.id)
      .filter((e) => e.event_type === "message_sent");

    expect(sentEvents).toHaveLength(1);
    expect(db.messages.get(message.id)!.status).toBe("sent");
  });
});

describe("failure handling and retries", () => {
  it("schedules a bounded retry for a transient failure", () => {
    const message = db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
      max_attempts: 3,
    });

    const [claimed] = db.claim_due_messages({ p_limit: 1 });

    const [outcome] = db.mark_message_failed({
      p_message_id: message.id,
      p_claim_token: claimed.claim_token,
      p_error_code: "130429",
      p_error_message: "Rate limit",
      p_retryable: true,
    });

    expect(outcome.will_retry).toBe(true);
    expect(db.messages.get(message.id)!.status).toBe("scheduled");
    expect(
      new Date(db.messages.get(message.id)!.scheduled_at!).getTime(),
    ).toBeGreaterThan(Date.now());
  });

  it("does not retry a permanent failure", () => {
    const message = db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    });

    const [claimed] = db.claim_due_messages({ p_limit: 1 });

    const [outcome] = db.mark_message_failed({
      p_message_id: message.id,
      p_claim_token: claimed.claim_token,
      p_error_code: "131026",
      p_error_message: "Undeliverable",
      p_retryable: false,
    });

    expect(outcome.will_retry).toBe(false);
    expect(db.messages.get(message.id)!.status).toBe("failed");
  });

  it("stops retrying once the attempt budget is spent — no infinite loop", () => {
    const message = db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
      max_attempts: 3,
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      // Make whatever retry was scheduled due again.
      const row = db.messages.get(message.id)!;
      if (row.status === "scheduled") {
        row.scheduled_at = new Date(Date.now() - 1000).toISOString();
      }

      const claimed = db.claim_due_messages({ p_limit: 1 });
      if (claimed.length === 0) break;

      db.mark_message_failed({
        p_message_id: message.id,
        p_claim_token: claimed[0].claim_token,
        p_error_code: "500",
        p_error_message: "Server error",
        p_retryable: true,
      });
    }

    const final = db.messages.get(message.id)!;
    expect(final.status).toBe("failed");
    expect(final.attempt_count).toBe(3);
  });

  it("marks a message failed through dispatch when the mock send fails", async () => {
    const message = db.insertMessage({
      phone: "+529981230000", // reserved: the mock transport always fails
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
      max_attempts: 1,
    });

    const [claimed] = db.claim_due_messages({ p_limit: 1 });
    const outcome = await dispatchClaimedMessage(
      claimed,
      "n8n",
    );

    expect(outcome.status).toBe("failed");
    expect(db.messages.get(message.id)!.status).toBe("failed");
    expect(db.messages.get(message.id)!.error_code).toBe("mock_undeliverable");
  });

  it("refuses to dispatch a message with no sendable content", async () => {
    const message = db.insertMessage({
      body: null,
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
      max_attempts: 1,
    });

    const [claimed] = db.claim_due_messages({ p_limit: 1 });
    const outcome = await dispatchClaimedMessage(
      claimed,
      "n8n",
    );

    expect(outcome.status).toBe("failed");
    expect(db.messages.get(message.id)!.error_code).toBe("invalid_payload");
  });
});

describe("stuck claim recovery", () => {
  it("releases a claim whose worker never reported back", () => {
    const message = db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    });

    db.claim_due_messages({ p_limit: 1 });

    // Simulate the worker dying 30 minutes ago.
    db.messages.get(message.id)!.claimed_at = new Date(
      Date.now() - 30 * 60_000,
    ).toISOString();

    expect(db.release_stuck_messages({ p_stale_minutes: 15 })).toBe(1);
    expect(db.messages.get(message.id)!.status).toBe("scheduled");
  });

  it("leaves a fresh claim alone", () => {
    db.insertMessage({ scheduled_at: new Date(Date.now() - 1000).toISOString() });
    db.claim_due_messages({ p_limit: 1 });

    expect(db.release_stuck_messages({ p_stale_minutes: 15 })).toBe(0);
  });

  it("fails a stuck message that has no attempts left", () => {
    const message = db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
      attempt_count: 2,
      max_attempts: 3,
    });

    db.claim_due_messages({ p_limit: 1 });
    db.messages.get(message.id)!.claimed_at = new Date(
      Date.now() - 30 * 60_000,
    ).toISOString();

    db.release_stuck_messages({ p_stale_minutes: 15 });

    expect(db.messages.get(message.id)!.status).toBe("failed");
  });
});

describe("webhook status ingestion", () => {
  function sentMessage() {
    const message = db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    });
    const [claimed] = db.claim_due_messages({ p_limit: 1 });
    db.mark_message_sent({
      p_message_id: message.id,
      p_claim_token: claimed.claim_token,
      p_provider_message_id: "wamid.ABC",
    });
    return message;
  }

  it("advances sent -> delivered -> read", () => {
    const message = sentMessage();

    expect(
      db.apply_provider_status({
        p_provider_message_id: "wamid.ABC",
        p_status: "delivered",
      }),
    ).toBe(true);
    expect(db.messages.get(message.id)!.status).toBe("delivered");

    expect(
      db.apply_provider_status({
        p_provider_message_id: "wamid.ABC",
        p_status: "read",
      }),
    ).toBe(true);
    expect(db.messages.get(message.id)!.status).toBe("read");
    expect(db.messages.get(message.id)!.read_at).toBeTruthy();
  });

  it("never regresses when callbacks arrive out of order", () => {
    const message = sentMessage();

    db.apply_provider_status({
      p_provider_message_id: "wamid.ABC",
      p_status: "read",
    });

    // A late 'delivered' must not clobber 'read'.
    expect(
      db.apply_provider_status({
        p_provider_message_id: "wamid.ABC",
        p_status: "delivered",
      }),
    ).toBe(false);

    expect(db.messages.get(message.id)!.status).toBe("read");
  });

  it("is idempotent on a repeated callback", () => {
    const message = sentMessage();

    expect(
      db.apply_provider_status({
        p_provider_message_id: "wamid.ABC",
        p_status: "delivered",
      }),
    ).toBe(true);
    expect(
      db.apply_provider_status({
        p_provider_message_id: "wamid.ABC",
        p_status: "delivered",
      }),
    ).toBe(false);

    expect(
      db.eventsFor(message.id).filter((e) => e.event_type === "message_delivered"),
    ).toHaveLength(1);
  });

  it("records a failure reported by the webhook", () => {
    const message = sentMessage();

    db.apply_provider_status({
      p_provider_message_id: "wamid.ABC",
      p_status: "failed",
      p_error_code: "131026",
      p_error_message: "Receiver cannot receive messages",
    });

    const row = db.messages.get(message.id)!;
    expect(row.status).toBe("failed");
    expect(row.error_code).toBe("131026");
  });

  it("ignores a callback for an unknown provider id", () => {
    expect(
      db.apply_provider_status({
        p_provider_message_id: "wamid.DESCONOCIDO",
        p_status: "delivered",
      }),
    ).toBe(false);
  });

  it("ignores status values we do not model", () => {
    sentMessage();

    expect(
      db.apply_provider_status({
        p_provider_message_id: "wamid.ABC",
        p_status: "deleted",
      }),
    ).toBe(false);
  });
});
