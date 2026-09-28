"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";
import { MESSAGE_STATUSES } from "@/lib/constants";
import { statusLabel } from "@/components/app/status-badge";
import type { MessageStatus } from "@/types/database";

/**
 * Filters are links, not client state: the URL is the filter, so a view
 * can be bookmarked and shared and the server renders exactly what the
 * URL says.
 */
export function StatusFilter({
  basePath,
  active,
  query,
  statuses = MESSAGE_STATUSES,
}: {
  basePath: string;
  active?: MessageStatus;
  query?: string;
  statuses?: readonly MessageStatus[];
}) {
  function href(status?: MessageStatus) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (query) params.set("q", query);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const chip = (isActive: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs transition-colors",
      isActive
        ? "border-[var(--primary)]/40 bg-[var(--primary)]/15 text-[var(--primary)]"
        : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-white/20 hover:text-[var(--foreground)]",
    );

  return (
    <div className="flex flex-wrap gap-2">
      <Link href={href()} className={chip(!active)}>
        Todos
      </Link>
      {statuses.map((status) => (
        <Link
          key={status}
          href={href(status)}
          className={chip(active === status)}
        >
          {statusLabel(status)}
        </Link>
      ))}
    </div>
  );
}
