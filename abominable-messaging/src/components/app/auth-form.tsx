"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  signInAction,
  signUpAction,
  type AuthFormState,
} from "@/app/auth/actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Un momento…" : label}
    </Button>
  );
}

export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const action = mode === "signin" ? signInAction : signUpAction;
  const [state, formAction] = useActionState<AuthFormState, FormData>(
    action,
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {mode === "signin" ? "Iniciar sesión" : "Crear cuenta"}
        </CardTitle>
        <CardDescription>
          {mode === "signin"
            ? "Acceso al panel de mensajería."
            : "Se creará tu organización automáticamente."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="tu@correo.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              required
              minLength={8}
              placeholder="Mínimo 8 caracteres"
            />
          </div>

          {state.error && (
            <p
              role="alert"
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
            >
              {state.error}
            </p>
          )}

          {state.notice && (
            <p
              role="status"
              className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-300"
            >
              {state.notice}
            </p>
          )}

          <SubmitButton
            label={mode === "signin" ? "Entrar" : "Crear cuenta"}
          />
        </form>
      </CardContent>
    </Card>
  );
}
