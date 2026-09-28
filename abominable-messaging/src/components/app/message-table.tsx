import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MessageActions } from "@/components/app/message-actions";
import { StatusBadge } from "@/components/app/status-badge";
import { formatInTimezone, utcToZonedWallClock } from "@/lib/datetime";
import { formatPhoneForDisplay } from "@/lib/phone";
import type { MessageWithContact } from "@/types/database";

function preview(message: MessageWithContact): string {
  if (message.message_type === "template") {
    return `Plantilla · ${message.template_name ?? "—"}`;
  }
  const body = message.body ?? "";
  return body.length > 70 ? `${body.slice(0, 70)}…` : body || "—";
}

/**
 * The single table used by Dashboard, Programados, Mensajes and
 * Historial. `timeColumn` decides whether the date shown is when the
 * message is due or when it actually went out.
 */
export function MessageTable({
  messages,
  displayTimezone,
  timeColumn = "scheduled",
}: {
  messages: MessageWithContact[];
  displayTimezone: string;
  timeColumn?: "scheduled" | "activity";
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="min-w-[160px]">Contacto</TableHead>
            <TableHead className="min-w-[220px]">Mensaje</TableHead>
            <TableHead className="w-[110px]">Fecha</TableHead>
            <TableHead className="w-[80px]">Hora</TableHead>
            <TableHead className="w-[130px]">Estado</TableHead>
            <TableHead className="w-[130px] text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {messages.map((message) => {
            const timezone = message.timezone || displayTimezone;

            const instant =
              timeColumn === "scheduled"
                ? message.scheduled_at
                : (message.read_at ??
                  message.delivered_at ??
                  message.sent_at ??
                  message.failed_at ??
                  message.cancelled_at ??
                  message.created_at);

            const wall = instant
              ? utcToZonedWallClock(instant, timezone)
              : null;

            return (
              <TableRow key={message.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="truncate font-medium">
                      {message.contact?.name ?? "Sin contacto"}
                    </span>
                    <span className="tabular text-[11px] text-[var(--muted-foreground)]">
                      {formatPhoneForDisplay(message.phone)}
                    </span>
                  </div>
                </TableCell>

                <TableCell>
                  <Link
                    href={`/messages/${message.id}`}
                    className="text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    title={message.body ?? undefined}
                  >
                    {preview(message)}
                  </Link>
                </TableCell>

                <TableCell className="tabular text-[var(--muted-foreground)]">
                  {wall?.date ?? "—"}
                </TableCell>

                <TableCell className="tabular text-[var(--muted-foreground)]">
                  {wall?.time ?? "—"}
                </TableCell>

                <TableCell>
                  <StatusBadge status={message.status} />
                  {message.status === "failed" && message.error_message && (
                    <p
                      className="mt-1 max-w-[220px] truncate text-[11px] text-red-300/80"
                      title={message.error_message}
                    >
                      {message.error_message}
                    </p>
                  )}
                </TableCell>

                <TableCell className="text-right">
                  <MessageActions message={message} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {messages.length > 0 && (
        <div className="border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--muted-foreground)]">
          {messages.length} mensaje{messages.length === 1 ? "" : "s"} · horas
          mostradas en la zona de cada mensaje ·{" "}
          {formatInTimezone(new Date(), displayTimezone)} ahora en{" "}
          {displayTimezone}
        </div>
      )}
    </div>
  );
}
