import { Badge } from "@/components/ui/badge";
import type { MessageStatus } from "@/types/database";

/** One place that decides what each status looks like and is called. */
const STATUS_META: Record<
  MessageStatus,
  { label: string; variant: "neutral" | "info" | "progress" | "success" | "warning" | "danger"; dot: string }
> = {
  draft: { label: "Borrador", variant: "neutral", dot: "bg-zinc-400" },
  scheduled: { label: "Programado", variant: "info", dot: "bg-sky-400" },
  processing: { label: "Enviando", variant: "progress", dot: "bg-violet-400" },
  sent: { label: "Enviado", variant: "success", dot: "bg-emerald-400" },
  delivered: { label: "Entregado", variant: "success", dot: "bg-emerald-400" },
  read: { label: "Leído", variant: "success", dot: "bg-emerald-300" },
  failed: { label: "Fallido", variant: "danger", dot: "bg-red-400" },
  cancelled: { label: "Cancelado", variant: "warning", dot: "bg-amber-400" },
};

export function statusLabel(status: MessageStatus): string {
  return STATUS_META[status]?.label ?? status;
}

export function StatusBadge({ status }: { status: MessageStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;

  return (
    <Badge variant={meta.variant}>
      <span className={`size-1.5 rounded-full ${meta.dot}`} aria-hidden />
      {meta.label}
    </Badge>
  );
}
