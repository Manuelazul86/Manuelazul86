import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { MessageTable } from "@/components/app/message-table";
import { Button } from "@/components/ui/button";
import { requireSessionContext } from "@/lib/auth";
import { listMessages } from "@/services/messages/queries";

export const metadata: Metadata = { title: "Programados" };
export const dynamic = "force-dynamic";

export default async function ScheduledPage() {
  const { organization } = await requireSessionContext();

  const messages = await listMessages(organization.id, {
    statuses: ["scheduled", "processing"],
    order: "scheduled_asc",
  });

  return (
    <>
      <PageHeader
        title="Programados"
        description="Mensajes en cola, ordenados por hora de envío"
        actions={
          <Button asChild size="sm">
            <Link href="/messages/new">
              <Plus className="size-4" />
              Nuevo
            </Link>
          </Button>
        }
      />

      {messages.length === 0 ? (
        <EmptyState
          title="La cola está vacía"
          description="No hay mensajes esperando su turno."
          action={
            <Button asChild size="sm">
              <Link href="/messages/new">Programar uno</Link>
            </Button>
          }
        />
      ) : (
        <MessageTable
          messages={messages}
          displayTimezone={organization.timezone}
        />
      )}
    </>
  );
}
