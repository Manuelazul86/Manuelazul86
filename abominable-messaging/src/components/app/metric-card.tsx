import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A single number, its label, and one line of context. No sparklines and
 * no gradients — the number is the content.
 */
export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = "default",
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: LucideIcon;
  href?: string;
  tone?: "default" | "danger" | "success" | "info";
}) {
  const toneClasses = {
    default: "text-[var(--foreground)]",
    info: "text-sky-300",
    success: "text-emerald-300",
    danger: "text-red-300",
  }[tone];

  const body = (
    <div
      className={cn(
        "group relative h-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-5",
        href && "transition-colors hover:border-white/20",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
          {label}
        </p>
        <Icon className="size-4 shrink-0 text-[var(--muted-foreground)]" />
      </div>

      <p className={cn("tabular mt-3 text-3xl font-semibold leading-none", toneClasses)}>
        {value}
      </p>

      {hint && (
        <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">{hint}</p>
      )}
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}
