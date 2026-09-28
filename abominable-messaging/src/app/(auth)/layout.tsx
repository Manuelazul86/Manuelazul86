import { APP_NAME, APP_SUBTITLE } from "@/lib/constants";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="bg-grid flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-1">
        <span className="text-lg font-semibold uppercase tracking-[0.3em]">
          {APP_NAME}
        </span>
        <span className="text-[11px] uppercase tracking-[0.28em] text-[var(--muted-foreground)]">
          {APP_SUBTITLE}
        </span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-8 text-[11px] text-[var(--muted-foreground)]">
        WhatsApp Business Cloud API · Uso interno
      </p>
    </div>
  );
}
