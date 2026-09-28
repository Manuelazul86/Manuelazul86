import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { signOutAction } from "@/app/auth/actions";
import { requireSessionContext } from "@/lib/auth";
import { isDangerousMockMode, isMockMode, serverEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Configuración" };
export const dynamic = "force-dynamic";

/**
 * Read-only configuration overview.
 *
 * It reports whether each secret is PRESENT — never its value. That is
 * enough to diagnose a misconfigured deployment without turning the page
 * into a credential leak.
 */
function envStatus(read: () => string | undefined): boolean {
  try {
    return Boolean(read());
  } catch {
    return false;
  }
}

export default async function SettingsPage() {
  const { email, organization } = await requireSessionContext();

  const checks = [
    { label: "NEXT_PUBLIC_SUPABASE_URL", ok: envStatus(() => serverEnv.supabaseUrl) },
    { label: "NEXT_PUBLIC_SUPABASE_ANON_KEY", ok: envStatus(() => serverEnv.supabaseAnonKey) },
    { label: "SUPABASE_SERVICE_ROLE_KEY", ok: envStatus(() => serverEnv.supabaseServiceRoleKey) },
    { label: "N8N_API_SECRET", ok: envStatus(() => serverEnv.n8nApiSecret) },
    { label: "WHATSAPP_ACCESS_TOKEN", ok: envStatus(() => serverEnv.whatsappAccessToken) },
    { label: "WHATSAPP_PHONE_NUMBER_ID", ok: envStatus(() => serverEnv.whatsappPhoneNumberId) },
    { label: "WHATSAPP_BUSINESS_ACCOUNT_ID", ok: envStatus(() => serverEnv.whatsappBusinessAccountId) },
    { label: "WHATSAPP_VERIFY_TOKEN", ok: envStatus(() => serverEnv.whatsappVerifyToken) },
    { label: "META_APP_SECRET", ok: envStatus(() => serverEnv.metaAppSecret) },
  ];

  const webhookUrl = `${serverEnv.appUrl.replace(/\/$/, "")}/api/webhooks/whatsapp`;

  return (
    <>
      <PageHeader
        title="Configuración"
        description="Estado de la organización y del entorno"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Organización</CardTitle>
            <CardDescription>
              El MVP opera con una sola organización. La arquitectura ya
              soporta varias.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <Row label="Nombre" value={organization.name} />
            <Row label="Slug" value={organization.slug} />
            <Row label="Zona horaria" value={organization.timezone} />
            <Row label="Usuario" value={email} />
            <Separator className="my-4" />
            <form action={signOutAction}>
              <Button variant="outline" size="sm" type="submit">
                Cerrar sesión
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Modo de envío</CardTitle>
            <CardDescription>
              Determina si los mensajes salen realmente a WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted-foreground)]">
                WHATSAPP_MOCK_MODE
              </span>
              <Badge variant={isMockMode() ? "warning" : "success"}>
                {isMockMode() ? "mock" : "real"}
              </Badge>
            </div>

            {isDangerousMockMode() && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300">
                Estás en producción con mock mode encendido. Ningún mensaje se
                entrega.
              </p>
            )}

            <Separator className="my-2" />

            <div className="space-y-1">
              <p className="text-[var(--muted-foreground)]">
                URL del webhook para Meta
              </p>
              <code className="block break-all rounded bg-black/40 px-2 py-1.5 font-mono text-[10px]">
                {webhookUrl}
              </code>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Variables de entorno</CardTitle>
            <CardDescription>
              Sólo se indica si la variable está definida. Nunca se muestra su
              valor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
              {checks.map((check) => (
                <li
                  key={check.label}
                  className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2"
                >
                  <code className="truncate font-mono text-[11px]">
                    {check.label}
                  </code>
                  <Badge variant={check.ok ? "success" : "danger"}>
                    {check.ok ? "definida" : "faltante"}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className="break-all text-right">{value}</span>
    </div>
  );
}
