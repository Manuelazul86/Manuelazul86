import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeDb } from "./helpers/fake-db";
import { createFakeSupabase, type FakeTables } from "./helpers/fake-postgrest";

/**
 * Route-handler tests.
 *
 * The handlers run for real — same Request in, same Response and status
 * code out. Only the two Supabase clients are swapped for in-memory
 * fakes, so routing, validation, authorization and the state-machine
 * guards are all genuinely exercised.
 */

const ORG_ID = "org-1";
const USER_ID = "user-1";

const tables: FakeTables = { contacts: [], messages: [], message_events: [] };
const db = new FakeDb();

/** Flipped by the auth tests to simulate an anonymous visitor. */
let session: { userId: string; email: string; organization: Record<string, unknown> } | null =
  {
    userId: USER_ID,
    email: "jm@abominable.mx",
    organization: {
      id: ORG_ID,
      name: "Abominable",
      slug: "abominable",
      timezone: "America/Cancun",
    },
  };

vi.mock("@/lib/auth", () => ({
  getSessionContext: async () => session,
  requireSessionContext: async () => {
    if (!session) throw new Error("redirect to /login");
    return session;
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () =>
    createFakeSupabase(tables, {
      rpc: (name, args) =>
        (db as unknown as Record<string, (a: unknown) => unknown>)[name]?.(args),
      onInsert: (table, row) => {
        if (table === "messages") db.messages.set(row.id, row as never);
      },
    }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () =>
    createFakeSupabase(tables, {
      rpc: (name, args) =>
        (db as unknown as Record<string, (a: unknown) => unknown>)[name]?.(args),
    }),
}));

const contactsRoute = await import("@/app/api/contacts/route");
const contactRoute = await import("@/app/api/contacts/[id]/route");
const messagesRoute = await import("@/app/api/messages/route");
const messageRoute = await import("@/app/api/messages/[id]/route");
const claimRoute = await import("@/app/api/n8n/messages/claim/route");
const webhookRoute = await import("@/app/api/webhooks/whatsapp/route");

const { NextRequest } = await import("next/server");

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function patch(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FUTURE_DATE = new Date(Date.now() + 48 * 3600 * 1000)
  .toISOString()
  .slice(0, 10);

beforeEach(() => {
  tables.contacts = [];
  tables.messages = [];
  tables.message_events = [];
  db.messages.clear();
  db.events.length = 0;

  session = {
    userId: USER_ID,
    email: "jm@abominable.mx",
    organization: {
      id: ORG_ID,
      name: "Abominable",
      slug: "abominable",
      timezone: "America/Cancun",
    },
  };
});

// ---------------------------------------------------------------------
describe("auth protection", () => {
  it("refuses to list contacts without a session", async () => {
    session = null;
    const response = await contactsRoute.GET(
      new NextRequest("http://localhost/api/contacts"),
    );
    expect(response.status).toBe(401);
  });

  it("refuses to create a contact without a session", async () => {
    session = null;
    const response = await contactsRoute.POST(
      post("http://localhost/api/contacts", {
        name: "Karla",
        phone: "+529981234567",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses to create a message without a session", async () => {
    session = null;
    const response = await messagesRoute.POST(
      post("http://localhost/api/messages", {
        mode: "now",
        phone: "+529981234567",
        message_type: "text",
        body: "Hola",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses to cancel a message without a session", async () => {
    session = null;
    const response = await messageRoute.DELETE(
      new NextRequest("http://localhost/api/messages/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(response.status).toBe(401);
  });

  it("does not leak rows into the response body on a 401", async () => {
    session = null;
    const response = await contactsRoute.GET(
      new NextRequest("http://localhost/api/contacts"),
    );
    const payload = await response.json();
    expect(payload.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
describe("contacts", () => {
  it("creates a contact and normalises the phone", async () => {
    const response = await contactsRoute.POST(
      post("http://localhost/api/contacts", {
        name: "Karla",
        phone: "998 123 4567",
        tags: ["aurea"],
      }),
    );

    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data.phone).toBe("+529981234567");
    expect(data.organization_id).toBe(ORG_ID);
  });

  it("rejects a contact with an unusable phone", async () => {
    const response = await contactsRoute.POST(
      post("http://localhost/api/contacts", { name: "Karla", phone: "hola" }),
    );

    expect(response.status).toBe(422);
  });

  it("rejects a contact with no name", async () => {
    const response = await contactsRoute.POST(
      post("http://localhost/api/contacts", { name: "  ", phone: "+529981234567" }),
    );

    expect(response.status).toBe(422);
  });

  it("finds a contact by a search term", async () => {
    await contactsRoute.POST(
      post("http://localhost/api/contacts", {
        name: "Karla Aurea",
        phone: "+529981234567",
      }),
    );
    await contactsRoute.POST(
      post("http://localhost/api/contacts", {
        name: "Otro Contacto",
        phone: "+529981230001",
      }),
    );

    const response = await contactsRoute.GET(
      new NextRequest("http://localhost/api/contacts?search=Karla"),
    );
    const { data } = await response.json();

    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("Karla Aurea");
  });

  it("edits a contact", async () => {
    const created = await (
      await contactsRoute.POST(
        post("http://localhost/api/contacts", {
          name: "Karla",
          phone: "+529981234567",
        }),
      )
    ).json();

    const response = await contactRoute.PATCH(
      patch(`http://localhost/api/contacts/${created.data.id}`, {
        name: "Karla Ruiz",
        phone: "+529981234567",
        company: "Aurea Realty",
      }),
      { params: Promise.resolve({ id: created.data.id }) },
    );

    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.name).toBe("Karla Ruiz");
    expect(data.company).toBe("Aurea Realty");
  });

  it("deletes a contact", async () => {
    const created = await (
      await contactsRoute.POST(
        post("http://localhost/api/contacts", {
          name: "Karla",
          phone: "+529981234567",
        }),
      )
    ).json();

    const response = await contactRoute.DELETE(
      new NextRequest("http://localhost/api/contacts/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: created.data.id }) },
    );

    expect(response.status).toBe(200);
    expect(tables.contacts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe("messages", () => {
  it("schedules a message for the future without dispatching it", async () => {
    const response = await messagesRoute.POST(
      post("http://localhost/api/messages", {
        mode: "schedule",
        phone: "+529981234567",
        message_type: "text",
        body: "Recordatorio de cita",
        scheduled_date: FUTURE_DATE,
        scheduled_time: "09:00",
        timezone: "America/Cancun",
      }),
    );

    expect(response.status).toBe(201);
    const { data } = await response.json();

    expect(data.dispatched).toBe(false);
    expect(data.message.status).toBe("scheduled");
    // 09:00 in Cancun (UTC-5) is 14:00 UTC.
    expect(data.message.scheduled_at).toContain("T14:00");
  });

  it("stores the scheduled instant in UTC, not the local wall clock", async () => {
    const response = await messagesRoute.POST(
      post("http://localhost/api/messages", {
        mode: "schedule",
        phone: "+529981234567",
        message_type: "text",
        body: "Hola",
        scheduled_date: FUTURE_DATE,
        scheduled_time: "18:30",
        timezone: "America/Cancun",
      }),
    );

    const { data } = await response.json();
    expect(data.message.scheduled_at.endsWith("Z")).toBe(true);
    expect(data.message.scheduled_at).toContain("T23:30");
  });

  it("sends immediately in mock mode and records the outcome", async () => {
    const response = await messagesRoute.POST(
      post("http://localhost/api/messages", {
        mode: "now",
        phone: "+529981234567",
        message_type: "text",
        body: "Hola ahora",
        timezone: "America/Cancun",
      }),
    );

    expect(response.status).toBe(201);
    const { data } = await response.json();

    expect(data.dispatched).toBe(true);
    expect(data.outcome.status).toBe("sent");
    expect(data.outcome.providerMessageId).toContain("MOCK");
  });

  it("rejects a schedule in the past", async () => {
    const response = await messagesRoute.POST(
      post("http://localhost/api/messages", {
        mode: "schedule",
        phone: "+529981234567",
        message_type: "text",
        body: "Tarde",
        scheduled_date: "2020-01-01",
        scheduled_time: "09:00",
        timezone: "America/Cancun",
      }),
    );

    expect(response.status).toBe(422);
  });

  it("rejects an invalid phone", async () => {
    const response = await messagesRoute.POST(
      post("http://localhost/api/messages", {
        mode: "now",
        phone: "9981234",
        message_type: "text",
        body: "Hola",
      }),
    );

    expect(response.status).toBe(422);
  });

  it("rejects a malformed JSON body", async () => {
    const response = await messagesRoute.POST(
      new NextRequest("http://localhost/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{no es json",
      }),
    );

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------
describe("rescheduling and cancelling", () => {
  async function createScheduled() {
    const response = await messagesRoute.POST(
      post("http://localhost/api/messages", {
        mode: "schedule",
        phone: "+529981234567",
        message_type: "text",
        body: "Original",
        scheduled_date: FUTURE_DATE,
        scheduled_time: "09:00",
        timezone: "America/Cancun",
      }),
    );
    const { data } = await response.json();
    return data.message;
  }

  it("reschedules a scheduled message", async () => {
    const message = await createScheduled();

    const response = await messageRoute.PATCH(
      patch(`http://localhost/api/messages/${message.id}`, {
        scheduled_date: FUTURE_DATE,
        scheduled_time: "20:00",
        timezone: "America/Cancun",
      }),
      { params: Promise.resolve({ id: message.id }) },
    );

    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.scheduled_at).toContain("T01:00"); // 20:00 Cancun = 01:00 UTC next day
    expect(data.status).toBe("scheduled");
  });

  it("edits the body of a scheduled message", async () => {
    const message = await createScheduled();

    const response = await messageRoute.PATCH(
      patch(`http://localhost/api/messages/${message.id}`, {
        body: "Texto corregido",
      }),
      { params: Promise.resolve({ id: message.id }) },
    );

    const { data } = await response.json();
    expect(data.body).toBe("Texto corregido");
  });

  it("refuses to reschedule into the past", async () => {
    const message = await createScheduled();

    const response = await messageRoute.PATCH(
      patch(`http://localhost/api/messages/${message.id}`, {
        scheduled_date: "2020-01-01",
        scheduled_time: "09:00",
      }),
      { params: Promise.resolve({ id: message.id }) },
    );

    expect(response.status).toBe(422);
  });

  it("cancels a scheduled message", async () => {
    const message = await createScheduled();

    const response = await messageRoute.DELETE(
      new NextRequest("http://localhost/api/messages/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: message.id }) },
    );

    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.status).toBe("cancelled");
    expect(data.cancelled_at).toBeTruthy();
  });

  it("refuses to cancel a message that was already sent", async () => {
    const message = await createScheduled();
    tables.messages.find((m) => m.id === message.id)!.status = "sent";

    const response = await messageRoute.DELETE(
      new NextRequest("http://localhost/api/messages/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: message.id }) },
    );

    expect(response.status).toBe(409);
  });

  it("refuses to edit a message that is already processing", async () => {
    const message = await createScheduled();
    tables.messages.find((m) => m.id === message.id)!.status = "processing";

    const response = await messageRoute.PATCH(
      patch(`http://localhost/api/messages/${message.id}`, { body: "Tarde" }),
      { params: Promise.resolve({ id: message.id }) },
    );

    expect(response.status).toBe(409);
  });

  it("returns 404 for a message that does not exist", async () => {
    const response = await messageRoute.PATCH(
      patch("http://localhost/api/messages/nope", { body: "x" }),
      { params: Promise.resolve({ id: "nope" }) },
    );

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------
describe("n8n claim endpoint", () => {
  const SECRET = process.env.N8N_API_SECRET!;

  it("rejects an unauthenticated claim", async () => {
    const response = await claimRoute.POST(
      post("http://localhost/api/n8n/messages/claim", { limit: 5 }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a claim with the wrong secret", async () => {
    const response = await claimRoute.POST(
      post(
        "http://localhost/api/n8n/messages/claim",
        { limit: 5 },
        { authorization: "Bearer incorrecto" },
      ),
    );
    expect(response.status).toBe(401);
  });

  it("returns due messages to an authorised caller", async () => {
    db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    });

    const response = await claimRoute.POST(
      post(
        "http://localhost/api/n8n/messages/claim",
        { limit: 5 },
        { authorization: `Bearer ${SECRET}` },
      ),
    );

    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.count).toBe(1);
    expect(data.messages[0].claim_token).toBeTruthy();
  });

  it("returns nothing on a second concurrent claim", async () => {
    db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    });

    const request = () =>
      claimRoute.POST(
        post(
          "http://localhost/api/n8n/messages/claim",
          { limit: 5 },
          { authorization: `Bearer ${SECRET}` },
        ),
      );

    const first = await (await request()).json();
    const second = await (await request()).json();

    expect(first.data.count).toBe(1);
    expect(second.data.count).toBe(0);
  });
});

// ---------------------------------------------------------------------
describe("whatsapp webhook", () => {
  it("echoes the challenge when the verify token matches", async () => {
    const response = await webhookRoute.GET(
      new NextRequest(
        `http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${process.env.WHATSAPP_VERIFY_TOKEN}&hub.challenge=1234567890`,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("1234567890");
  });

  it("rejects the handshake when the verify token is wrong", async () => {
    const response = await webhookRoute.GET(
      new NextRequest(
        "http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=incorrecto&hub.challenge=123",
      ),
    );

    expect(response.status).toBe(403);
  });

  it("rejects a handshake with the wrong mode", async () => {
    const response = await webhookRoute.GET(
      new NextRequest(
        `http://localhost/api/webhooks/whatsapp?hub.mode=unsubscribe&hub.verify_token=${process.env.WHATSAPP_VERIFY_TOKEN}&hub.challenge=123`,
      ),
    );

    expect(response.status).toBe(403);
  });

  it("applies a delivery status to the matching message", async () => {
    const message = db.insertMessage({
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    });
    const [claimed] = db.claim_due_messages({ p_limit: 1 });
    db.mark_message_sent({
      p_message_id: message.id,
      p_claim_token: claimed.claim_token,
      p_provider_message_id: "wamid.WEBHOOK",
    });

    const response = await webhookRoute.POST(
      post("http://localhost/api/webhooks/whatsapp", {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  statuses: [
                    {
                      id: "wamid.WEBHOOK",
                      status: "delivered",
                      timestamp: String(Math.floor(Date.now() / 1000)),
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.processed).toBe(1);
    expect(db.messages.get(message.id)!.status).toBe("delivered");
  });

  it("acknowledges an unparseable body instead of making Meta retry forever", async () => {
    const response = await webhookRoute.POST(
      new NextRequest("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{roto",
      }),
    );

    expect(response.status).toBe(200);
  });

  it("ignores a status for a provider id we do not know", async () => {
    const response = await webhookRoute.POST(
      post("http://localhost/api/webhooks/whatsapp", {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [{ id: "wamid.AJENO", status: "read" }],
                },
              },
            ],
          },
        ],
      }),
    );

    const payload = await response.json();
    expect(payload.processed).toBe(0);
  });
});
