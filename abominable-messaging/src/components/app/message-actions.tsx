"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, CalendarClock, Ban, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SUPPORTED_TIMEZONES, MAX_TEXT_LENGTH } from "@/lib/constants";
import { utcToZonedWallClock } from "@/lib/datetime";
import type { MessageWithContact } from "@/types/database";

/**
 * Row actions for a scheduled message: view, reschedule/edit, cancel.
 *
 * Every mutation goes through the API routes rather than writing to
 * Supabase from the browser, so the state-machine rules live in exactly
 * one place on the server.
 */
export function MessageActions({ message }: { message: MessageWithContact }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const editable = message.status === "scheduled" || message.status === "draft";

  const initial = message.scheduled_at
    ? utcToZonedWallClock(message.scheduled_at, message.timezone)
    : { date: "", time: "" };

  const [body, setBody] = React.useState(message.body ?? "");
  const [date, setDate] = React.useState(initial.date);
  const [time, setTime] = React.useState(initial.time);
  const [timezone, setTimezone] = React.useState(message.timezone);

  async function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/messages/${message.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(message.message_type === "text" ? { body } : {}),
        scheduled_date: date,
        scheduled_time: time,
        timezone,
      }),
    });

    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error?.message ?? "No se pudo reprogramar el mensaje");
      return;
    }

    setEditOpen(false);
    router.refresh();
  }

  async function confirmCancel() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/messages/${message.id}`, {
      method: "DELETE",
    });

    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error?.message ?? "No se pudo cancelar el mensaje");
      return;
    }

    setCancelOpen(false);
    router.refresh();
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button asChild variant="ghost" size="icon" title="Ver detalle">
        <Link href={`/messages/${message.id}`}>
          <Eye className="size-4" />
          <span className="sr-only">Ver</span>
        </Link>
      </Button>

      {editable && (
        <>
          <Button
            variant="ghost"
            size="icon"
            title="Editar / reprogramar"
            onClick={() => setEditOpen(true)}
          >
            <CalendarClock className="size-4" />
            <span className="sr-only">Reprogramar</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            title="Cancelar"
            className="text-red-300 hover:text-red-200"
            onClick={() => setCancelOpen(true)}
          >
            <Ban className="size-4" />
            <span className="sr-only">Cancelar</span>
          </Button>
        </>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar mensaje programado</DialogTitle>
            <DialogDescription>
              Los cambios sólo son posibles mientras el mensaje siga
              programado.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitEdit} className="space-y-4">
            {message.message_type === "text" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-body">Mensaje</Label>
                  <span className="tabular text-[11px] text-[var(--muted-foreground)]">
                    {body.length}/{MAX_TEXT_LENGTH}
                  </span>
                </div>
                <Textarea
                  id="edit-body"
                  value={body}
                  maxLength={MAX_TEXT_LENGTH}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-date">Fecha</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-time">Hora</Label>
                <Input
                  id="edit-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-tz">Zona horaria</Label>
              <Select
                id="edit-tz"
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

            {error && (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Cerrar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Guardar cambios
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar mensaje</DialogTitle>
            <DialogDescription>
              El mensaje no se enviará. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Volver
            </Button>
            <Button
              variant="destructive"
              onClick={confirmCancel}
              disabled={busy}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Cancelar mensaje
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
