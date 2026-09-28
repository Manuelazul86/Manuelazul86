import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  Users,
  Plus,
} from "lucide-react";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { MessageTable } from "@/components/app/message-table";
import { MetricCard } from "@/components/app/metric-card";
import { Button } from "@/components/ui/button";
import { requireSessionContext } from "@/lib/auth";
import {
  getDashboardMetrics,
  getUpcomingMessages,
} from "@/services/messages/queries";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { organization } = await requireSessionContext();

  const [metrics, upcoming] = await Promise.all([
    getDashboardMetrics(organization.id, organization.timezone),
    getUpcomingMessages(organization.id, 10),
  ]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Operación de mensajería · ${organization.timezone}`}
        actions={
          <Button asChild size="sm">
            <Link href="/messages/new">
              <Plus className="size-4" />
              Nuevo mensaje
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Programados"
          value={metrics.scheduled}
          hint="En cola, esperando su hora"
          icon={CalendarClock}
          href="/scheduled"
          tone="info"
        />
        <MetricCard
          label="Enviados hoy"
          value={metrics.sentToday}
          hint="Entregados o en camino"
          icon={CheckCircle2}
          href="/history?status=sent"
          tone="success"
        />
        <MetricCard
          label="Fallidos"
          value={metrics.failed}
          hint="Agotaron sus reintentos"
          icon={AlertTriangle}
          href="/history?status=failed"
          tone={metrics.failed > 0 ? "danger" : "default"}
        />
        <MetricCard
          label="Contactos"
          value={metrics.contacts}
          hint="En la agenda"
          icon={Users}
          href="/contacts"
        />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Próximos mensajes
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Los siguientes envíos en la cola
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/scheduled">Ver todos</Link>
          </Button>
        </div>

        {upcoming.length === 0 ? (
          <EmptyState
            title="No hay mensajes programados"
            description="Cuando programes un envío aparecerá aquí con su cuenta regresiva."
            action={
              <Button asChild size="sm">
                <Link href="/messages/new">Programar el primero</Link>
              </Button>
            }
          />
        ) : (
          <MessageTable
            messages={upcoming}
            displayTimezone={organization.timezone}
          />
        )}
      </section>
    </>
  );
}
