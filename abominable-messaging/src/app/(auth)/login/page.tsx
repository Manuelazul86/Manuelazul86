import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/components/app/auth-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default function LoginPage() {
  return (
    <div className="space-y-4">
      <AuthForm mode="signin" />
      <p className="text-center text-xs text-[var(--muted-foreground)]">
        ¿Primera vez?{" "}
        <Link href="/signup" className="text-[var(--primary)] hover:underline">
          Crear cuenta
        </Link>
      </p>
    </div>
  );
}
