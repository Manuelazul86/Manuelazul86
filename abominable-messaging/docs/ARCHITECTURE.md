# Arquitectura — Abominable Messaging

## 1. Qué es este sistema

Un programador de mensajes de WhatsApp. Su única responsabilidad es:
*poner un mensaje concreto en el teléfono de una persona concreta, a una
hora concreta, exactamente una vez.*

Todo lo demás (CRM, campañas, IA, inbox) queda explícitamente fuera del
MVP. Ver `FUTURE_ROADMAP.md`.

## 2. Piezas y responsabilidades

```
Usuario
  │
  ▼
Next.js en Vercel ─────────► Supabase / PostgreSQL
  (UI + API interna)          (fuente de verdad)
                                    ▲
                                    │ claim / sent / failed
                                    │
                              n8n en tu VPS
                                    │
                                    ▼
                          WhatsApp Cloud API (Meta)
                                    │
                                    ▼
                               Destinatario

Estados de entrega:
Meta ──webhook──► Next.js /api/webhooks/whatsapp ──► Supabase ──► Dashboard
```

| Pieza | Responsabilidad | NO hace |
|---|---|---|
| **Next.js / Vercel** | UI, autenticación, validación, API interna, webhook | No guarda estado propio |
| **Supabase** | Fuente de verdad, RLS, máquina de estados atómica | No llama a Meta |
| **n8n (tu VPS)** | Reloj y transporte: pregunta qué toca, lo manda, reporta | No decide reintentos ni toca tablas directamente |
| **WhatsApp Cloud API** | Entrega real | — |

La regla que ordena todo: **n8n es un ejecutor, no un cerebro.** Toda la
lógica que puede corromper datos vive en Postgres y se expone por
endpoints nuestros.

## 3. Modelo de datos

```
organizations ──< organization_members >── auth.users
      │
      ├──< contacts
      │        │
      └──< messages ──< message_events
```

`organization_id` está presente en **todas** las tablas de negocio desde
la primera migración. Hoy hay una sola organización, pero cuando llegue
multi-cliente o white-label sólo hay que insertar filas: no hay que
migrar datos ni reescribir las políticas de seguridad.

### Máquina de estados de `messages`

```
                   ┌──────────────────────────────┐
                   │                              │
  draft ──► scheduled ──► processing ──► sent ──► delivered ──► read
              │  ▲            │
              │  └── retry ───┘
              │               │
              ▼               ▼
          cancelled        failed
```

Reglas invariantes:

* `scheduled → processing` sólo ocurre dentro de `claim_due_messages()`
  o `claim_message_by_id()`, nunca con un UPDATE suelto.
* `processing → sent|failed` exige presentar el `claim_token` emitido
  en el claim.
* El usuario sólo puede editar o cancelar en `draft` y `scheduled`. Lo
  impone la RLS *y* el `WHERE` del route handler.
* Los estados de entrega son monótonos: un `delivered` que llega tarde
  nunca sobrescribe un `read`.

## 4. Idempotencia: por qué no se envía dos veces

Es el requisito más importante del sistema, así que está defendido en
cuatro capas independientes:

1. **Claim atómico.** `claim_due_messages()` hace
   `SELECT ... FOR UPDATE SKIP LOCKED` seguido del `UPDATE` en una sola
   sentencia. Dos ejecuciones simultáneas del workflow no pueden recibir
   la misma fila: la segunda salta las filas bloqueadas y recibe un
   conjunto vacío.
2. **Claim token de un solo uso.** Cada claim genera un UUID nuevo.
   `mark_message_sent()` exige `status = 'processing' AND claim_token = $token`.
   Un worker rezagado que reporte con un token ya consumido no cambia
   nada y recibe `applied: false`.
3. **n8n nunca reintenta el envío.** Los nodos de salida a Meta tienen
   `retryOnFail` desactivado a propósito: un reintento de red podría
   entregar el mensaje dos veces. Los reintentos son responsabilidad de
   la base de datos, que los cuenta.
4. **Presupuesto de intentos acotado.** `attempt_count < max_attempts`
   es parte de la condición de claim, así que un mensaje problemático
   deja de reclamarse solo. No hay bucles infinitos posibles.

Y un quinto detalle: si un worker muere después de reclamar,
`release_stuck_messages()` devuelve la fila a `scheduled` pasados N
minutos, para que un fallo de infraestructura no pierda el mensaje.

### Decisión: ¿RPC de Postgres o endpoints de la app? Ambos

El brief planteaba elegir entre endpoints seguros o una función RPC
atómica. **Elegimos las dos, en capas**, porque resuelven problemas
distintos:

* La **atomicidad sólo se puede garantizar dentro de una transacción de
  Postgres**. Cualquier lógica en la aplicación que haga SELECT y luego
  UPDATE puede ser adelantada por otro worker entre las dos sentencias.
  Por eso el claim es una función SQL.
* El **control** (autenticación, validación, límites, auditoría, forma
  de la respuesta) pertenece a la aplicación. Por eso n8n no habla con
  Supabase: habla con `/api/n8n/*`, que valida el bearer, aplica los
  esquemas de Zod y sólo entonces invoca la RPC con la service-role key.

Resultado: n8n nunca tiene credenciales de base de datos, y el invariante
de "un solo envío" no depende de que n8n esté bien configurado.

## 5. Zonas horarias

Una sola regla, sin excepciones:

* **La base de datos guarda siempre UTC** (`timestamptz`).
* El compositor **no envía un instante**: envía `{fecha, hora, zona}` —
  es decir, exactamente lo que el usuario tecleó — y el servidor lo
  resuelve con `zonedWallClockToUtc()`.
* La UI convierte de UTC a la zona de cada mensaje al pintar.

Zona por defecto: `America/Cancun` (UTC−5 todo el año; México eliminó el
horario de verano en 2022). La conversión usa `Intl`, no una librería de
fechas, para que cliente y servidor usen la misma base de datos tz y no
puedan divergir.

El instante sugerido en el compositor se calcula **en el servidor** y se
pasa como prop: leer el reloj durante el render de un componente cliente
provocaría un desajuste de hidratación.

## 6. Seguridad

Resumen; el detalle está en `SECURITY.md`.

* **RLS activo en todas las tablas**, sin políticas para `anon`: un
  cliente sin sesión no ve absolutamente nada.
* **La service-role key nunca sale del servidor.** Los módulos que la
  usan importan `server-only`, así que intentar usarlos desde un
  componente cliente rompe el build.
* **`/api/n8n/*`** exige `Authorization: Bearer <N8N_API_SECRET>`,
  comparado en tiempo constante.
* **El webhook** verifica la firma `X-Hub-Signature-256` de Meta sobre
  el cuerpo crudo.

## 7. Estructura del código

```
src/
  app/
    (auth)/            login, signup
    (dashboard)/       dashboard, messages, scheduled, contacts,
                       templates, history, settings
    api/
      contacts/        CRUD (sesión de usuario, RLS)
      messages/        CRUD + envío inmediato
      n8n/messages/    claim | sent | failed | release (bearer)
      webhooks/whatsapp  verificación + estados (firma Meta)
    auth/actions.ts    server actions de sesión
  components/
    ui/                primitivas shadcn/ui
    app/               composiciones del producto
  lib/                 env, validación, fechas, teléfonos, utilidades
  services/
    whatsapp/          ÚNICO punto que habla con Meta
    messages/          queries y despacho
  types/
supabase/migrations/   SQL versionado
n8n/                   workflow importable
docs/
tests/
```

Regla de dependencias: `app/` puede importar de `services/` y `lib/`;
`services/` puede importar de `lib/`; `lib/` no importa de nadie. Ningún
componente React llama a WhatsApp.

## 8. Preparado para el ecosistema Abominable

Sin implementarlo todavía, la arquitectura ya admite:

* **Multi-cliente / white-label** — `organization_id` y las políticas RLS
  ya existen.
* **Campañas y secuencias** — una campaña es un generador de filas en
  `messages`; el motor de envío no cambia.
* **Inbox bidireccional** — el webhook ya recibe el evento `messages`,
  hoy sólo procesamos `statuses`.
* **Generación con IA** — el compositor produce un `body`; de dónde salga
  ese texto es indiferente al pipeline.
* **Integración con Sales Engine / CRM** — `metadata JSONB` en `messages`
  y la tabla `message_events` dan el punto de enganche sin migración.
