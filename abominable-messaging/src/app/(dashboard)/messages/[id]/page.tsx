import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { MessageActions } from "@/components/app/message-actions";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSessionContext } from "@/lib/auth";
import { formatInTimezone } from "@/lib/datetime";
import { formatPhoneForDisplay } from "@/lib/phone";
import { getMessage, getMessageEvents } from "@/services/messages/queries";
import { isMockMessageId } from "@/services/whatsapp/mock";

export const metadata: Metadata = { title: "Detalle del mensaje" };
export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = {
  message_created: "Creado",
  message_scheduled: "Programado",
  message_updated: "Editado",
  message_rescheduled: "Reprogramado",
  message_processing: "Reclamado para envío",
  message_sent: "Enviado",
  message_delivered: "Entregado",
  message_read: "Leído",
  message_failed: "Fallido",
  message_cancelled: "Cancelado",
  message_retry_scheduled: "Reintento programado",
  message_claim_released: "Reclamo liberado",
};

export default async function MessageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organization } = await requireSessionContext();
  const { id } = await params;

  const message = await getMessage(organization.id, id);
  if (!message) notFound();

  const events = await getMessageEvents(id);
  const timezone = message.timezone || organization.timezone;

  return (
    <>
      <PageHeader
        title="Detalle del mensaje"
        description={`ID ${message.id}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/messages">
                <ArrowLeft className="size-4" />
                Volver
              </Link>
            </Button>
            <MessageActions message={message} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Contenido</CardTitle>
              <StatusBadge status={message.status} />
            </CardHeader>
            <CardContent className="space-y-4">
              {message.message_type === "text" ? (
                <p className="whitespace-pre-wrap rounded-md border border-[var(--border)] bg-black/25 p-4 text-sm leading-relaxed">
                  {message.body}
                </p>
              ) : (
                <div className="space-y-3 rounded-md border border-[var(--border)] bg-black/25 p-4 text-sm">
                  <Field label="Plantilla" value={message.template_name ?? "—"} />
                  <Field label="Idioma" value={message.template_language ?? "—"} />
                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      Variables
                    </p>
                    <pre className="overflow-x-auto rounded bg-black/40 p-3 font-mono text-[11px]">
                      {JSON.stringify(message.template_variables, null, 2)}
                    </pre>
                  </div>
                </div>
              )}

              {message.status === "failed" && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-200">
                  <p className="font-medium">
                    Error {message.error_code ?? "desconocido"}
                  </p>
                  <p className="mt-1 text-red-300/90">
                    {message.error_message ?? "Sin detalle"}
                  </p>
                  <p className="mt-2 text-red-300/70">
                    Intentos: {message.attempt_count} de {message.max_attempts}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Auditoría</CardTitle>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)]">
                  Sin eventos registrados.
                </p>
              ) : (
                <ol className="space-y-0">
                  {events.map((event, index) => (
                    <li
                      key={event.id}
                      className="relative flex gap-3 pb-4 last:pb-0"
                    >
                      <div className="flex flex-col items-center">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                        {index < events.length - 1 && (
                          <span className="mt-1 w-px flex-1 bg-[var(--border)]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium">
                          {EVENT_LABELS[event.event_type] ?? event.event_type}
                        </p>
                        <p className="tabular text-[11px] text-[var(--muted-foreground)]">
                          {formatInTimezone(event.created_at, timezone, {
                            second: "2-digit",
                          })}{" "}
                          · {event.actor}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Entrega</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <Field
              label="Contacto"
              value={message.contact?.name ?? "Sin contacto"}
            />
            <Field
              label="Número"
              value={formatPhoneForDisplay(message.phone)}
            />
            <Field label="Zona horaria" value={timezone} />
            <Field
              label="Programado"
              value={formatInTimezone(message.scheduled_at, timezone)}
            />
            <Field
              label="Enviado"
              value={formatInTimezone(message.sent_at, timezone)}
            />
            <Field
              label="Entregado"
              value={formatInTimezone(message.delivered_at, timezone)}
            />
            <Field
              label="Leído"
              value={formatInTimezone(message.read_at, timezone)}
            />
            <Field
              label="Provider ID"
              value={message.provider_message_id ?? "—"}
              mono
            />
            {isMockMessageId(message.provider_message_id) && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                Este envío fue simulado en mock mode. No salió a WhatsApp.
              </p>
            )}
            <Field
              label="Intentos"
              value={`${message.attempt_count} / ${message.max_attempts}`}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-[var(--muted-foreground)]">{label}</span>
      <span
        className={`break-all text-right ${mono ? "font-mono text-[10px]" : "tabular"}`}
      >
        {value}
      </span>
    </div>
  );
}
