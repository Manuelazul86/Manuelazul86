"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SidebarBrand, SidebarNav } from "@/components/app/sidebar";
import { cn } from "@/lib/utils";

interface AppShellProps {
  email: string;
  organizationName: string;
  timezone: string;
  mockMode: boolean;
  mockInProduction: boolean;
  children: React.ReactNode;
}

/**
 * Desktop-first two-column shell. The sidebar collapses into a sheet
 * below `lg`, which keeps the dense tables usable on a phone without a
 * separate mobile layout.
 */
export function AppShell({
  email,
  organizationName,
  timezone,
  mockMode,
  mockInProduction,
  children,
}: AppShellProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="min-h-dvh bg-[var(--background)]">
      {mockInProduction && (
        <div className="sticky top-0 z-50 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-center text-xs font-medium text-amber-200">
          MOCK MODE ACTIVO EN PRODUCCIÓN — ningún mensaje se está entregando
          realmente. Configura WHATSAPP_MOCK_MODE=false para enviar de verdad.
        </div>
      )}

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)]/40 lg:flex">
          <SidebarBrand />
          <div className="flex-1 overflow-y-auto pb-4">
            <SidebarNav />
          </div>
          <div className="border-t border-[var(--border)] px-6 py-4">
            <p className="truncate text-xs text-[var(--foreground)]">{email}</p>
            <p className="truncate text-[11px] text-[var(--muted-foreground)]">
              {organizationName} · {timezone}
            </p>
          </div>
        </aside>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-[var(--border)] bg-[var(--card)]">
              <div className="flex items-center justify-between pr-3">
                <SidebarBrand />
                <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                  <X className="size-4" />
                  <span className="sr-only">Cerrar menú</span>
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto pb-4">
                <SidebarNav onNavigate={() => setOpen(false)} />
              </div>
              <div className="border-t border-[var(--border)] px-6 py-4">
                <p className="truncate text-xs">{email}</p>
                <p className="truncate text-[11px] text-[var(--muted-foreground)]">
                  {organizationName} · {timezone}
                </p>
              </div>
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className={cn(
              "sticky z-40 flex h-14 items-center gap-3 border-b border-[var(--border)]",
              "bg-[var(--background)]/85 px-4 backdrop-blur lg:px-6",
              mockInProduction ? "top-[33px]" : "top-0",
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setOpen(true)}
            >
              <Menu className="size-4" />
              <span className="sr-only">Abrir menú</span>
            </Button>

            <div className="flex items-baseline gap-2 lg:hidden">
              <span className="text-sm font-semibold uppercase tracking-[0.2em]">
                Abominable
              </span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {mockMode && !mockInProduction && (
                <span className="hidden rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 sm:inline">
                  Mock mode
                </span>
              )}
              <Button asChild size="sm">
                <Link href="/messages/new">
                  <Plus className="size-4" />
                  Nuevo mensaje
                </Link>
              </Button>
            </div>
          </header>

          <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
