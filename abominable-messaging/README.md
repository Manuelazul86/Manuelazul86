# ABOMINABLE MESSAGING

Programación y envío de mensajes de WhatsApp sobre la **WhatsApp Business
Cloud API oficial de Meta**.

Next.js · TypeScript · Tailwind · shadcn/ui · Supabase · n8n · Vercel

---

## Qué hace

Programas un mensaje para una hora concreta, y se envía a esa hora.
Exactamente una vez. Con registro de qué pasó.

- Contactos con validación E.164
- Envío inmediato o programado, con zona horaria explícita
- Editar, reprogramar y cancelar mensajes en cola
- Historial con estados reales de WhatsApp: enviado, entregado, leído, fallido
- Auditoría completa por mensaje
- **Modo mock**: todo el flujo funciona sin credenciales de Meta

## Arranque rápido

```bash
cd abominable-messaging
npm install
cp .env.example .env.local   # rellena los valores
npm run dev
```

Con `WHATSAPP_MOCK_MODE=true` (el valor por defecto) puedes probar el
sistema completo sin tener nada de Meta: los envíos se simulan y quedan
marcados con un id `wamid.MOCK-…`.

Para que algo funcione de verdad necesitas, como mínimo, un proyecto de
Supabase con el esquema instalado. La instalación completa es **un solo
copy-paste** de [`supabase/setup-all.sql`](supabase/setup-all.sql) en el
SQL Editor de Supabase.

La checklist completa, fase por fase, está en
**[`docs/PASO_A_PASO.md`](docs/PASO_A_PASO.md)**.

## Comandos

```bash
npm run dev        # desarrollo
npm run build      # build de producción
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run test       # Vitest
npm run verify     # los cuatro anteriores, en orden
```

## Arquitectura en una línea

**Vercel** sirve la UI y la API · **Supabase** es la fuente de verdad y
dueña de la máquina de estados · **n8n** en tu VPS es el reloj y el
transporte · **Meta** entrega.

```
Next.js ──► Supabase ◄── n8n ──► WhatsApp Cloud API ──► Destinatario
   ▲                                                         │
   └──────────── webhook de estados ◄────────────────────────┘
```

El detalle, incluida la razón de cada decisión:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## No se envía dos veces

Es el requisito central, y está defendido en cuatro capas:

1. **Claim atómico** — `SELECT ... FOR UPDATE SKIP LOCKED` dentro de una
   sola sentencia. Dos workers simultáneos no pueden recibir la misma
   fila.
2. **Token de un solo uso** — cada claim emite un UUID; confirmar el
   envío exige presentarlo. Un worker rezagado no cambia nada.
3. **n8n nunca reintenta el envío** — un reintento de red podría entregar
   el mensaje dos veces. Los reintentos los programa la base de datos.
4. **Presupuesto de intentos acotado** — `attempt_count < max_attempts`
   forma parte de la condición de claim: no hay bucles infinitos.

## Documentación

| Documento | Para qué |
|---|---|
| **[PASO_A_PASO](docs/PASO_A_PASO.md)** | **Empieza aquí: de cero a enviando** |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Cómo encaja todo y por qué |
| [SUPABASE_SETUP](docs/SUPABASE_SETUP.md) | Crear el proyecto y aplicar migraciones |
| [WHATSAPP_SETUP](docs/WHATSAPP_SETUP.md) | Credenciales de Meta, webhook, regla de 24 h |
| [N8N_SETUP](docs/N8N_SETUP.md) | Conectar tu n8n paso a paso |
| [N8N_WORKFLOW](docs/N8N_WORKFLOW.md) | Referencia nodo a nodo |
| [VERCEL_DEPLOYMENT](docs/VERCEL_DEPLOYMENT.md) | Deploy y variables por entorno |
| [SECURITY](docs/SECURITY.md) | Modelo de amenazas y manejo de secretos |
| [TESTING](docs/TESTING.md) | Qué está probado y qué no |
| [FUTURE_ROADMAP](docs/FUTURE_ROADMAP.md) | Lo que viene después |

## Estructura

```
src/
  app/             rutas (dashboard, auth, API)
  components/      ui/ primitivas · app/ producto
  lib/             env, validación, fechas, teléfonos
  services/
    whatsapp/      ÚNICO punto que habla con Meta
    messages/      consultas y despacho
supabase/migrations/   SQL versionado
n8n/               workflow importable
docs/
tests/
```

## Políticas de WhatsApp

Este sistema usa **sólo la API oficial**. No hay WhatsApp Web, ni
Puppeteer, ni librerías no oficiales, ni ningún intento de evadir la
ventana de 24 horas. Esa disciplina es lo que mantiene el número vivo.

La arquitectura distingue explícitamente entre **mensaje de sesión**
(texto libre, sólo dentro de la ventana de 24 h) y **mensaje de
plantilla** (único camino permitido fuera de ella).

## Estado

MVP funcional. No incluye — y es deliberado — CRM, chat bidireccional,
IA, campañas masivas, secuencias, facturación ni white-label. Ver el
roadmap.
