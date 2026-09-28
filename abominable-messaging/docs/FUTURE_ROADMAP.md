# Roadmap

Lo que viene después del MVP, en el orden en que tiene sentido
construirlo. Nada de esto está implementado hoy.

## Fase 2 — Operación diaria

**Importación masiva de contactos (CSV).**
Lo primero que se echa de menos cuando la agenda pasa de 20 contactos.
Necesita: parser, previsualización, deduplicación por
`(organization_id, phone)` — el índice único ya existe.

**Vista de calendario.**
La tabla de programados no escala visualmente. Un calendario semanal con
los envíos por hora. Los datos ya están; es sólo presentación.

**Recurrencia.**
"Cada lunes a las 9". Se resuelve con una tabla `message_schedules` que
genere filas en `messages`; el motor de envío no cambia nada.

## Fase 3 — Campañas

**Campaigns.**
Una campaña es un generador de mensajes: un segmento de contactos + una
plantilla + una fecha. Tabla `campaigns` y `campaign_id` en `messages`.
El pipeline de envío, el claim y los reintentos siguen igual — esa es
exactamente la razón de haber mantenido a n8n como mero ejecutor.

Requiere antes: control de rate limit por WABA, y una pantalla de
progreso de campaña.

**Sequences y follow-ups.**
"Si no responde en 48 h, manda el segundo mensaje". Necesita saber si
respondió, o sea el Inbox.

## Fase 4 — Bidireccional

**Inbox.**
El webhook ya recibe el campo `messages` de Meta; hoy sólo procesamos
`statuses`. Añadir una tabla `inbound_messages` y una vista de
conversación.

Esto desbloquea lo más valioso de todo: **saber si la ventana de 24 horas
está abierta** para cada contacto, y por tanto si puedes mandar texto
libre o necesitas plantilla. Hoy eso hay que saberlo de memoria.

**Estado de la ventana en el compositor.**
Un indicador en vivo: "ventana abierta, quedan 6 h" o "cerrada, usa
plantilla". Depende directamente del Inbox.

## Fase 5 — Inteligencia

**Generación de mensajes con IA.**
El compositor produce un `body`; de dónde salga ese texto es indiferente
al pipeline. Redacción a partir de un brief, ajuste de tono, variantes.

**Sugerencia de mejor hora de envío.**
Con suficiente historial de `read_at`, aprender a qué hora lee cada
contacto.

**Clasificación de respuestas.**
Interesado / no interesado / pregunta — con el Inbox en marcha.

## Fase 6 — Ecosistema Abominable

Aquí es donde este módulo deja de ser una herramienta suelta.

**Multi-cliente y white-label.**
`organization_id` y las políticas RLS ya están desde la primera
migración, precisamente para que esto no requiera una migración
dolorosa. Falta: selector de organización, invitaciones, roles, logo y
dominio por cliente.

**Integración con Abominable Sales Engine.**
Este módulo se convierte en el canal de salida de WhatsApp del motor de
ventas. El punto de enganche ya existe: `metadata JSONB` en `messages`
para guardar el `lead_id` de origen, y `message_events` para devolver la
actividad.

**TuCasaPosible y Aurea / TuLuxury.**
Recordatorios de cita, seguimiento de leads inmobiliarios, avisos de
nuevas propiedades. Cada proyecto sería una organización distinta dentro
del mismo despliegue.

**CRM / HubSpot.**
Sincronización bidireccional de contactos.

**Facturación (Stripe).**
Sólo tiene sentido si Abominable Messaging se vende a terceros como
producto. Requiere: planes, medición de uso (ya la tenemos en
`message_events`) y límites por plan.

## Deuda técnica pendiente

Cosas que hoy son aceptables pero que habrá que atender:

* **Tipos generados de Supabase.** `src/types/database.ts` está escrito a
  mano. En cuanto el proyecto esté enlazado:
  `npx supabase gen types typescript --linked`.
* **Rate limiting** en los endpoints públicos.
* **Tests de concurrencia contra Postgres real** — ver `TESTING.md`.
* **Paginación.** Las listas están limitadas a 100-500 filas. Con volumen
  real hará falta paginar de verdad.
* **Rotación automática del token de WhatsApp** antes de que caduque.
* **Observabilidad**: hoy la auditoría vive en `message_events`, que es
  suficiente para depurar pero no para alertar. Faltan alertas cuando la
  tasa de fallos sube.

## Explícitamente fuera de alcance, siempre

* Cualquier cosa que evada la ventana de 24 horas.
* WhatsApp Web, Puppeteer o librerías no oficiales.
* Envío masivo a listas no consentidas.

No es una limitación técnica: es lo que mantiene el número vivo.
