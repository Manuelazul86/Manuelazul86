import type { Metadata } from "next";
import Link from "next/link";
import { LayoutTemplate } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireSessionContext } from "@/lib/auth";
import { formatInTimezone } from "@/lib/datetime";
import { listUsedTemplates } from "@/services/messages/queries";

export const metadata: Metadata = { title: "Plantillas" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const { organization } = await requireSessionContext();
  const templates = await listUsedTemplates(organization.id);

  return (
    <>
      <PageHeader
        title="Plantillas"
        description="Plantillas de WhatsApp usadas por esta organización"
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/messages/new">
              <LayoutTemplate className="size-4" />
              Enviar con plantilla
            </Link>
          </Button>
        }
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>La regla de las 24 horas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
          <p>
            <span className="text-[var(--foreground)]">
              Mensaje de sesión (normal):
            </span>{" "}
            texto libre. Sólo se entrega si el contacto te escribió en las
            últimas 24 horas. Cada mensaje entrante del cliente reinicia esa
            ventana.
          </p>
          <p>
            <span className="text-[var(--foreground)]">
              Mensaje de plantilla:
            </span>{" "}
            único camino permitido fuera de la ventana. La plantilla debe estar
            aprobada previamente por Meta en el WhatsApp Manager, y aquí sólo
            se referencia por nombre, idioma y variables.
          </p>
          <p>
            El MVP no incluye editor de plantillas: se crean y aprueban en
            Meta. Este panel muestra las que ya se han usado.
          </p>
        </CardContent>
      </Card>

      {templates.length === 0 ? (
        <EmptyState
          title="Todavía no se ha usado ninguna plantilla"
          description="Cuando envíes un mensaje de tipo plantilla aparecerá aquí con su historial de uso."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Plantilla</TableHead>
                <TableHead className="w-[120px]">Idioma</TableHead>
                <TableHead className="w-[100px]">Usos</TableHead>
                <TableHead className="w-[200px]">Último uso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={`${template.name}-${template.language}`}>
                  <TableCell className="font-mono text-xs">
                    {template.name}
                  </TableCell>
                  <TableCell className="text-[var(--muted-foreground)]">
                    {template.language}
                  </TableCell>
                  <TableCell className="tabular">{template.uses}</TableCell>
                  <TableCell className="tabular text-[var(--muted-foreground)]">
                    {formatInTimezone(template.lastUsed, organization.timezone)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
