# Workflow de n8n — referencia técnica

Referencia nodo a nodo de `n8n/whatsapp-scheduler.json`. Para la puesta
en marcha, ver `N8N_SETUP.md`.

## Diagrama

```
Schedule Trigger (1 min)
        │
        ▼
Claim due messages ────► POST /api/n8n/messages/claim
        │                 scheduled -> processing (atómico)
        ▼
Split messages (data.messages)
        │
        ▼
Template or text?
   ├── true ──► Send template ──┐
   └── false ─► Send text ──────┤
                                ▼
                        Normalise result
                                │
                                ▼
                        Sent or failed?
                          ├── ok ──► Report sent   ► POST /api/n8n/messages/sent
                          └── no ──► Report failed ► POST /api/n8n/messages/failed
```

## Variables necesarias en n8n

| Variable | Ejemplo | Para qué |
|---|---|---|
| `ABOMINABLE_APP_URL` | `https://abominable-messaging.vercel.app` | Base de la API interna |
| `ABOMINABLE_N8N_SECRET` | `a3f9…` | Bearer de `/api/n8n/*` |
| `WHATSAPP_ACCESS_TOKEN` | `EAAG…` | Bearer de Graph API |
| `WHATSAPP_PHONE_NUMBER_ID` | `123456789012345` | Número remitente |
| `WHATSAPP_API_VERSION` | `v21.0` | Versión de Graph |

Requiere además `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.

---

## Nodo 1 — Schedule Trigger

`n8n-nodes-base.scheduleTrigger`, intervalo **1 minuto**.

La precisión del sistema es de un minuto: un mensaje programado a las
09:00:30 sale en la pasada de las 09:01. Para mayor precisión baja el
intervalo, pero entonces sube el volumen de llamadas al claim.

## Nodo 2 — Claim due messages

```
POST {{ $env.ABOMINABLE_APP_URL }}/api/n8n/messages/claim
Authorization: Bearer {{ $env.ABOMINABLE_N8N_SECRET }}
Content-Type: application/json

{ "limit": 25, "worker": "n8n-main" }
```

Respuesta:

```json
{
  "data": {
    "count": 2,
    "messages": [
      {
        "id": "uuid",
        "organization_id": "uuid",
        "phone": "+529981234567",
        "body": "Hola Karla",
        "message_type": "text",
        "template_name": null,
        "template_language": null,
        "template_variables": {},
        "claim_token": "uuid",
        "attempt_count": 1,
        "max_attempts": 3,
        "scheduled_at": "2026-09-28T14:00:00.000Z"
      }
    ]
  }
}
```

**`claim_token` es lo importante.** Sin él no se puede reportar el
resultado. Llévalo intacto hasta los nodos finales.

Reintentos: `retryOnFail: true`, 2 intentos, 3 s. Reclamar es seguro de
reintentar — si la primera llamada llegó a ejecutarse, la segunda
simplemente no encuentra esas filas.

## Nodo 3 — Split messages

`splitOut` sobre `data.messages`, para procesar cada mensaje como un item
independiente. Con `count: 0` el flujo termina aquí, que es el caso
normal la mayoría de los minutos.

## Nodo 4 — Template or text?

`IF` sobre `{{ $json.message_type }} === "template"`.
Salida *true* → plantilla. Salida *false* → texto.

## Nodos 5 y 6 — Send template / Send text

```
POST https://graph.facebook.com/{version}/{phone_number_id}/messages
Authorization: Bearer {{ $env.WHATSAPP_ACCESS_TOKEN }}
```

Texto:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "+529981234567",
  "type": "text",
  "text": { "preview_url": false, "body": "Hola Karla" }
}
```

Plantilla:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "+529981234567",
  "type": "template",
  "template": {
    "name": "recordatorio_cita",
    "language": { "code": "es_MX" },
    "components": [
      { "type": "body", "parameters": [
        { "type": "text", "text": "Karla" },
        { "type": "text", "text": "lunes 3pm" }
      ] }
    ]
  }
}
```

Las variables se ordenan **numéricamente** (`1, 2, 10`), no
alfabéticamente, porque son posiciones del cuerpo de la plantilla.

Configuración crítica:

* `neverError: true` y `fullResponse: true` — un 4xx/5xx debe llegar al
  clasificador, no abortar la ejecución.
* `onError: continueRegularOutput` — un item que falla no debe impedir
  que los demás se envíen.
* **`retryOnFail` DESACTIVADO.** Es la regla más importante del workflow.
  Un timeout de red no significa que Meta no haya recibido la petición;
  reintentar podría entregar el mensaje dos veces. Cuando el envío falla
  de verdad, el reintento lo programa la base de datos, con el contador
  de intentos incrementado.

## Nodo 7 — Normalise result

Nodo Code. Convierte la respuesta de Meta en una forma única y clasifica
el error:

```js
const PERMANENT = new Set([100, 131008, 131009, 131026, 131047, 131051,
                           132000, 132001, 132005, 132007, 132012,
                           133010, 190]);
const TRANSIENT = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 133016]);
```

Éxito → `{ ok: true, message_id, claim_token, provider_message_id }`
Fallo → `{ ok: false, message_id, claim_token, error_code, error_message, retryable }`

Por defecto: 4xx desconocido = permanente, 5xx y 429 = transitorio.

Un 200 **sin** `messages[0].id` se trata como fallo permanente: sin ese
id no podríamos correlacionar los webhooks de estado con la fila.

## Nodo 8 — Sent or failed?

`IF` sobre `{{ $json.ok }}`.

## Nodo 9 — Report sent

```
POST {{ $env.ABOMINABLE_APP_URL }}/api/n8n/messages/sent
Authorization: Bearer {{ $env.ABOMINABLE_N8N_SECRET }}

{ "message_id": "...", "claim_token": "...", "provider_message_id": "wamid...." }
```

Respuesta: `{"data":{"applied":true}}`.

`applied: false` significa que la fila ya no estaba en `processing` con
ese token — una confirmación repetida, o un worker rezagado. **No es un
error**: es la protección contra doble envío haciendo su trabajo.

Por eso `retryOnFail` sí está activo aquí (3 intentos, 5 s): reportar es
idempotente, y perder la confirmación sería peor que repetirla.

## Nodo 10 — Report failed

```
POST {{ $env.ABOMINABLE_APP_URL }}/api/n8n/messages/failed
Authorization: Bearer {{ $env.ABOMINABLE_N8N_SECRET }}

{
  "message_id": "...",
  "claim_token": "...",
  "error_code": "130429",
  "error_message": "Rate limit hit",
  "retryable": true
}
```

Respuesta: `{"data":{"final_status":"scheduled","will_retry":true}}`.

La app decide el destino:

* `retryable` **y** quedan intentos → vuelve a `scheduled` con backoff
  exponencial (1, 2, 4 … minutos, tope 30).
* Si no → `failed` definitivo.

n8n nunca toma esa decisión. Ahí está la garantía de que no existe un
bucle infinito: el presupuesto de intentos vive en una sola fila de una
sola tabla.

## Idempotencia — resumen operativo

| Escenario | Qué ocurre |
|---|---|
| Dos ejecuciones simultáneas | La segunda recibe `count: 0` (SKIP LOCKED) |
| El claim se reintenta | Las filas ya no cumplen `status = 'scheduled'` |
| `Report sent` se reintenta | `applied: false`, sin cambios |
| El worker muere tras enviar | `release_stuck_messages` lo devuelve; el reintento puede duplicar — por eso `max_attempts` es bajo y el token es de un solo uso |
| Meta responde 200 sin id | Fallo permanente: no se puede rastrear |

## Endpoints disponibles

| Método | Ruta | Para qué |
|---|---|---|
| POST | `/api/n8n/messages/claim` | Reclamar mensajes vencidos |
| POST | `/api/n8n/messages/sent` | Reportar éxito |
| POST | `/api/n8n/messages/failed` | Reportar fallo |
| POST | `/api/n8n/messages/release?stale_minutes=15` | Liberar claims atascados |

Todos exigen `Authorization: Bearer <N8N_API_SECRET>`.
