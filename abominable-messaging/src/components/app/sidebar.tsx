"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  CalendarClock,
  Users,
  LayoutTemplate,
  History,
  Settings,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { APP_NAME, APP_SUBTITLE } from "@/lib/constants";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/messages", label: "Mensajes", icon: MessageSquare },
  { href: "/scheduled", label: "Programados", icon: CalendarClock },
  { href: "/contacts", label: "Contactos", icon: Users },
  { href: "/templates", label: "Plantillas", icon: LayoutTemplate },
  { href: "/history", label: "Historial", icon: History },
  { href: "/settings", label: "Configuración", icon: Settings },
] as const;

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-white/[0.06] text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:bg-white/[0.03] hover:text-[var(--foreground)]",
            )}
          >
            {active && (
              <span
                className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-[var(--primary)]"
                aria-hidden
              />
            )}
            <Icon
              className={cn(
                "size-4 shrink-0",
                active ? "text-[var(--primary)]" : "text-current",
              )}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarBrand() {
  return (
    <Link href="/dashboard" className="flex flex-col gap-0.5 px-6 py-5">
      <span className="text-sm font-semibold uppercase tracking-[0.22em]">
        {APP_NAME}
      </span>
      <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
        {APP_SUBTITLE}
      </span>
    </Link>
  );
}
