"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Pencil, Trash2, Search, Loader2, Send } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/app/page-header";
import { normalizePhone } from "@/lib/phone";
import type { Contact } from "@/types/database";

interface FormState {
  id?: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  tags: string;
  notes: string;
}

const EMPTY: FormState = {
  name: "",
  phone: "",
  email: "",
  company: "",
  tags: "",
  notes: "",
};

export function ContactsManager({
  contacts,
  initialSearch,
}: {
  contacts: Contact[];
  initialSearch: string;
}) {
  const router = useRouter();

  const [search, setSearch] = React.useState(initialSearch);
  const [form, setForm] = React.useState<FormState | null>(null);
  const [deleting, setDeleting] = React.useState<Contact | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function openCreate() {
    setError(null);
    setForm({ ...EMPTY });
  }

  function openEdit(contact: Contact) {
    setError(null);
    setForm({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email ?? "",
      company: contact.company ?? "",
      tags: contact.tags.join(", "),
      notes: contact.notes ?? "",
    });
  }

  function runSearch(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = search.trim();
    router.push(trimmed ? `/contacts?q=${encodeURIComponent(trimmed)}` : "/contacts");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;

    const normalized = normalizePhone(form.phone);
    if (!normalized) {
      setError("El teléfono debe poder convertirse a E.164, ej. +529981234567");
      return;
    }

    setBusy(true);
    setError(null);

    const payload = {
      name: form.name,
      phone: normalized,
      email: form.email,
      company: form.company,
      notes: form.notes,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };

    const response = await fetch(
      form.id ? `/api/contacts/${form.id}` : "/api/contacts",
      {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    setBusy(false);

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error?.message ?? "No se pudo guardar el contacto");
      return;
    }

    setForm(null);
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/contacts/${deleting.id}`, {
      method: "DELETE",
    });

    setBusy(false);

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.error?.message ?? "No se pudo eliminar el contacto");
      return;
    }

    setDeleting(null);
    router.refresh();
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={runSearch} className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nombre, teléfono, empresa…"
            className="pl-9"
            aria-label="Buscar contactos"
          />
        </form>

        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" />
          Nuevo contacto
        </Button>
      </div>

      {contacts.length === 0 ? (
        <EmptyState
          title="Sin contactos"
          description="Agrega el primer contacto para empezar a enviar mensajes."
          action={
            <Button size="sm" onClick={openCreate}>
              Agregar contacto
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Nombre</TableHead>
                <TableHead className="w-[170px]">Teléfono</TableHead>
                <TableHead className="hidden md:table-cell">Empresa</TableHead>
                <TableHead className="hidden lg:table-cell">Etiquetas</TableHead>
                <TableHead className="w-[140px] text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell>
                    <span className="font-medium">{contact.name}</span>
                    {contact.email && (
                      <p className="text-[11px] text-[var(--muted-foreground)]">
                        {contact.email}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="tabular font-mono text-xs">
                    {contact.phone}
                  </TableCell>
                  <TableCell className="hidden text-[var(--muted-foreground)] md:table-cell">
                    {contact.company ?? "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {contact.tags.length === 0 ? (
                        <span className="text-[var(--muted-foreground)]">—</span>
                      ) : (
                        contact.tags.map((tag) => (
                          <Badge key={tag} variant="outline">
                            {tag}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon" title="Enviar mensaje">
                        <Link href="/messages/new">
                          <Send className="size-4" />
                          <span className="sr-only">Enviar</span>
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Editar"
                        onClick={() => openEdit(contact)}
                      >
                        <Pencil className="size-4" />
                        <span className="sr-only">Editar</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Eliminar"
                        className="text-red-300 hover:text-red-200"
                        onClick={() => setDeleting(contact)}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Eliminar</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form?.id ? "Editar contacto" : "Nuevo contacto"}
            </DialogTitle>
            <DialogDescription>
              El teléfono se normaliza a formato E.164 antes de guardarse.
            </DialogDescription>
          </DialogHeader>

          {form && (
            <form onSubmit={save} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="c-name">Nombre</Label>
                  <Input
                    id="c-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-phone">Teléfono</Label>
                  <Input
                    id="c-phone"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+529981234567"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-email">Email</Label>
                  <Input
                    id="c-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-company">Empresa</Label>
                  <Input
                    id="c-company"
                    value={form.company}
                    onChange={(e) =>
                      setForm({ ...form, company: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="c-tags">Etiquetas (separadas por comas)</Label>
                <Input
                  id="c-tags"
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="cliente, aurea, vip"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="c-notes">Notas</Label>
                <Textarea
                  id="c-notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="min-h-[80px]"
                />
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
                  onClick={() => setForm(null)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  Guardar
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar contacto</DialogTitle>
            <DialogDescription>
              Se eliminará «{deleting?.name}». Los mensajes ya enviados se
              conservan en el historial.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
