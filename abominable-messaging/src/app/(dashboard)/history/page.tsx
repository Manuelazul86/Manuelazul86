import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { MessageTable } from "@/components/app/message-table";
import { StatusFilter } from "@/components/app/status-filter";
import { requireSessionContext } from "@/lib/auth";
import { listMessages } from "@/services/messages/queries";
import type { MessageStatus } from "@/types/database";

export const metadata: Metadata = { title: "Historial" };
export const dynamic = "force-dynamic";

/** Terminal states only — this screen answers "what happened". */
const HISTORY_STATUSES = [
  "sent",
  "delivered",
  "read",
  "failed",
  "cancelled",
] as const satisfies readonly MessageStatus[];

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { organization } = await requireSessionContext();
  const params = await searchParams;

  const status = HISTORY_STATUSES.includes(params.status as never)
    ? (params.status as MessageStatus)
    : undefined;

  const messages = await listMessages(organization.id, {
    statuses: status ? [status] : [...HISTORY_STATUSES],
    order: "created_desc",
  });

  return (
    <>
      <PageHeader
        title="Historial"
        description="Enviados, entregados, leídos, fallidos y cancelados"
      />

      <StatusFilter
        basePath="/history"
        active={status}
        statuses={HISTORY_STATUSES}
      />

      <div className="mt-4">
        {messages.length === 0 ? (
          <EmptyState
            title="Sin historial"
            description="Aquí aparecerán los mensajes una vez que salgan de la cola."
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
