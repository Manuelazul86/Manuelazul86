import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { MessageTable } from "@/components/app/message-table";
import { StatusFilter } from "@/components/app/status-filter";
import { Button } from "@/components/ui/button";
import { requireSessionContext } from "@/lib/auth";
import { listMessages } from "@/services/messages/queries";
import { MESSAGE_STATUSES } from "@/lib/constants";
import type { MessageStatus } from "@/types/database";

export const metadata: Metadata = { title: "Mensajes" };
export const dynamic = "force-dynamic";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { organization } = await requireSessionContext();
  const params = await searchParams;

  const status = MESSAGE_STATUSES.includes(params.status as MessageStatus)
    ? (params.status as MessageStatus)
    : undefined;

  const messages = await listMessages(organization.id, {
    statuses: status ? [status] : undefined,
    search: params.q,
  });

  return (
    <>
      <PageHeader
        title="Mensajes"
        description="Todos los mensajes de la organización"
        actions={
          <Button asChild size="sm">
            <Link href="/messages/new">
              <Plus className="size-4" />
              Nuevo
            </Link>
          </Button>
        }
      />

      <StatusFilter basePath="/messages" active={status} query={params.q} />

      <div className="mt-4">
        {messages.length === 0 ? (
          <EmptyState
            title="Sin mensajes"
            description="Todavía no hay mensajes que coincidan con este filtro."
          />
        ) : (
          <MessageTable
            messages={messages}
            displayTimezone={organization.timezone}
            timeColumn="activity"
          />
        )}
      </div>
    </>
  );
}
