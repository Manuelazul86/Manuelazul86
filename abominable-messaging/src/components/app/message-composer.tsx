"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Send, CalendarClock, Loader2, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_TEXT_LENGTH,
  SUPPORTED_TIMEZONES,
  DEFAULT_TIMEZONE,
} from "@/lib/constants";
import { zonedWallClockToUtc } from "@/lib/datetime";
import { normalizePhone } from "@/lib/phone";
import type { Contact } from "@/types/database";

interface ComposerProps {
  contacts: Contact[];
  defaultTimezone: string;
  /** Suggested send date (YYYY-MM-DD), resolved on the server. */
  defaultDate: string;
  /** Suggested send time (HH:mm), resolved on the server. */
  defaultTime: string;
  mockMode: boolean;
}

/**
 * The composer submits { mode, ...fields } to POST /api/messages.
 *
 * It never sends a UTC timestamp: it sends the wall clock the user typed
 * plus the timezone they picked, and the server resolves the instant.
 * That keeps one conversion implementation and makes the stored value
 * auditable — you can always recompute it from what was typed.
 */
export function MessageComposer({
  contacts,
  defaultTimezone,
  defaultDate,
  defaultTime,
  mockMode,
}: ComposerProps) {
  const router = useRouter();

  const [contactId, setContactId] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [messageType, setMessageType] = React.useState<"text" | "template">(
    "text",
  );
  const [body, setBody] = React.useState("");
  const [templateName, setTemplateName] = React.useState("");
  const [templateLanguage, setTemplateLanguage] = React.useState("es_MX");
  const [templateVariables, setTemplateVariables] = React.useState("");
  const [timezone, setTimezone] = React.useState(
    defaultTimezone || DEFAULT_TIMEZONE,
  );

  /*
   * The suggested send time ("now + 15 minutes") is computed on the
   * server and handed down as a prop. Reading the clock during render
   * here would be impure and would make the server-rendered HTML
   * disagree with the client on hydration.
   */
  const [date, setDate] = React.useState(defaultDate);
  const [time, setTime] = React.useState(defaultTime);

  const scheduledPreview = React.useMemo(
    () => zonedWallClockToUtc(date, time, timezone),
    [date, time, timezone],
  );

  const [busy, setBusy] = React.useState<"now" | "schedule" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  function selectContact(id: string) {
    setContactId(id);
    const contact = contacts.find((c) => c.id === id);
    if (contact) setPhone(contact.phone);
  }

  const normalized = phone ? normalizePhone(phone) : null;
  const phoneValid = normalized !== null;


  function parseVariables(): Record<string, string> | "invalid" {
    const raw = templateVariables.trim();
    if (raw === "") return {};

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return "invalid";
      }
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        out[key] = String(value);
      }
      return out;
    } catch {
      return "invalid";
    }
  }

  async function submit(mode: "now" | "schedule") {
    setError(null);
    setNotice(null);

    if (!phoneValid) {
      setError("El teléfono debe estar en formato E.164, ej. +529981234567");
      return;
    }

    if (messageType === "text" && body.trim() === "") {
      setError("Escribe el mensaje antes de enviarlo");
      return;
    }

    const variables = parseVariables();
    if (variables === "invalid") {
      setError('Las variables deben ser JSON, ej. {"1":"Karla","2":"lunes"}');
      return;
    }

    if (mode === "schedule" && scheduledPreview === null) {
      setError("Fecha u hora inválida");
      return;
    }

    setBusy(mode);

    const payload = {
      mode,
      contact_id: contactId || null,
      phone: normalized,
      message_type: messageType,
      ...(messageType === "text"
        ? { body }
        : {
            template_name: templateName,
            template_language: templateLanguage,
          }),
      template_variables: variables,
      timezone,
      ...(mode === "schedule"
        ? { scheduled_date: date, scheduled_time: time }
        : {}),
    };

    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setBusy(null);

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error?.message ?? "No se pudo crear el mensaje");
      return;
    }

    const result = await response.json();
    const id = result?.data?.message?.id;

    if (mode === "now") {
      const outcome = result?.data?.outcome;
      if (outcome?.status === "failed") {
        setError(`El envío falló: ${outcome.errorMessage ?? outcome.errorCode}`);
        if (id) router.push(`/messages/${id}`);
        return;
      }
      setNotice(
        mockMode
          ? "Mensaje enviado en modo mock (no salió a WhatsApp)."
          : "Mensaje enviado.",
      );
    }

    router.push(id ? `/messages/${id}` : "/messages");
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Nuevo mensaje</CardTitle>
          <CardDescription>
            Envía ahora o programa el envío. Las fechas se guardan en UTC y se
            muestran en la zona que elijas.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact">Contacto</Label>
              <Select
                id="contact"
                value={contactId}
                onChange={(e) => selectContact(e.target.value)}
              >
                <option value="">Sin contacto (número libre)</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name} · {contact.phone}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Número WhatsApp</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+529981234567"
                inputMode="tel"
                aria-invalid={phone !== "" && !phoneValid}
                className={
                  phone !== "" && !phoneValid
                    ? "border-red-500/60 focus-visible:ring-red-500/60"
                    : undefined
                }
              />
              <p className="text-[11px] text-[var(--muted-foreground)]">
                {phone === ""
                  ? "Formato internacional E.164"
                  : phoneValid
                    ? `Se enviará a ${normalized}`
                    : "Número inválido"}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="type">Tipo de mensaje</Label>
            <Select
              id="type"
              value={messageType}
              onChange={(e) =>
                setMessageType(e.target.value as "text" | "template")
              }
            >
              <option value="text">Mensaje normal (ventana de 24 h)</option>
              <option value="template">Plantilla de WhatsApp</option>
            </Select>
          </div>

          {messageType === "text" ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="body">Mensaje</Label>
                <span
                  className={`tabular text-[11px] ${
                    body.length > MAX_TEXT_LENGTH * 0.9
                      ? "text-amber-300"
                      : "text-[var(--muted-foreground)]"
                  }`}
                >
                  {body.length}/{MAX_TEXT_LENGTH}
                </span>
              </div>
              <Textarea
                id="body"
                value={body}
                maxLength={MAX_TEXT_LENGTH}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Escribe el mensaje…"
              />
            </div>
          ) : (
            <div className="space-y-4 rounded-md border border-[var(--border)] bg-black/20 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="template-name">Nombre de plantilla</Label>
                  <Input
                    id="template-name"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="recordatorio_cita"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="template-lang">Idioma</Label>
                  <Input
                    id="template-lang"
                    value={templateLanguage}
                    onChange={(e) => setTemplateLanguage(e.target.value)}
                    placeholder="es_MX"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="template-vars">Variables (JSON)</Label>
                <Textarea
                  id="template-vars"
                  value={templateVariables}
                  onChange={(e) => setTemplateVariables(e.target.value)}
                  className="min-h-[80px] font-mono text-xs"
                  placeholder={'{"1":"Karla","2":"lunes 3pm"}'}
                />
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  Las claves son las posiciones del cuerpo de la plantilla,
                  empezando en 1.
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="date">Fecha</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="time">Hora</Label>
              <Input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tz">Zona horaria</Label>
              <Select
                id="tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {SUPPORTED_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
            >
              {error}
            </p>
          )}

          {notice && (
            <p
              role="status"
              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
            >
              {notice}
            </p>
          )}

          <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => submit("now")}
              disabled={busy !== null}
            >
              {busy === "now" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Enviar ahora
            </Button>
            <Button onClick={() => submit("schedule")} disabled={busy !== null}>
              {busy === "schedule" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarClock className="size-4" />
              )}
              Programar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Resumen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <Row label="Destino" value={normalized ?? "—"} />
            <Row
              label="Tipo"
              value={messageType === "text" ? "Mensaje normal" : "Plantilla"}
            />
            <Row label="Zona" value={timezone} />
            <Row
              label="Programado (UTC)"
              value={scheduledPreview?.toISOString() ?? "—"}
            />
            <Row
              label="Caracteres"
              value={
                messageType === "text" ? `${body.length}` : "n/a (plantilla)"
              }
            />
          </CardContent>
        </Card>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" />
            <div className="space-y-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
              <p>
                <span className="text-[var(--foreground)]">
                  Regla de 24 horas.
                </span>{" "}
                Un mensaje normal sólo llega si el contacto te escribió en las
                últimas 24 horas. Fuera de esa ventana Meta exige una plantilla
                aprobada.
              </p>
              {mockMode && (
                <p className="text-amber-300">
                  Mock mode activo: los envíos se simulan y no salen a
                  WhatsApp.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className="tabular break-all text-right">{value}</span>
    </div>
  );
}
