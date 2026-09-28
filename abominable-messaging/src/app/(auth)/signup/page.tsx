import type { Metadata } from "next";
import Link from "next/link";

import { AuthForm } from "@/components/app/auth-form";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function SignUpPage() {
  return (
    <div className="space-y-4">
      <AuthForm mode="signup" />
      <p className="text-center text-xs text-[var(--muted-foreground)]">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="text-[var(--primary)] hover:underline">
          Iniciar sesión
        </Link>
      </p>
    </div>
  );
}
