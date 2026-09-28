import type { Metadata } from "next";

import { MessageComposer } from "@/components/app/message-composer";
import { PageHeader } from "@/components/app/page-header";
import { requireSessionContext } from "@/lib/auth";
import { isMockMode } from "@/lib/env";
import {
  getSuggestedSendTime,
  listContacts,
} from "@/services/messages/queries";

export const metadata: Metadata = { title: "Nuevo mensaje" };
export const dynamic = "force-dynamic";

export default async function NewMessagePage() {
  const { organization } = await requireSessionContext();
  // Resolved server-side so the client's first render matches the
  // server's exactly; see getSuggestedSendTime().
  const [contacts, suggested] = await Promise.all([
    listContacts(organization.id),
    getSuggestedSendTime(organization.timezone),
  ]);

  return (
    <>
      <PageHeader
        title="Nuevo mensaje"
        description="Enviar de inmediato o dejarlo programado"
      />
      <MessageComposer
        contacts={contacts}
        defaultTimezone={organization.timezone}
        defaultDate={suggested.date}
        defaultTime={suggested.time}
        mockMode={isMockMode()}
      />
    </>
  );
}
