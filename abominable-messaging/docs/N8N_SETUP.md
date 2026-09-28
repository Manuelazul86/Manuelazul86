# n8n — conexión paso a paso

n8n ya está en tu VPS; aquí no se instala nada. Lo que sigue es cómo
conectarlo a Abominable Messaging.

**El papel de n8n es deliberadamente pequeño:** es el reloj y el
transporte. No decide reintentos, no escribe en la base de datos y no
tiene credenciales de Supabase. Si n8n se cae, ningún mensaje se pierde:
siguen en `scheduled` esperando.

## 1. Variables de entorno en el VPS

Añádelas al `docker-compose.yml` de n8n (o a su `.env`) y reinicia:

```yaml
environment:
  - ABOMINABLE_APP_URL=https://tu-dominio.vercel.app
  - ABOMINABLE_N8N_SECRET=<el mismo N8N_API_SECRET de la app>
  - WHATSAPP_ACCESS_TOKEN=<token permanente de Meta>
  - WHATSAPP_PHONE_NUMBER_ID=<phone number id>
  - WHATSAPP_API_VERSION=v21.0
  # Necesario para que las expresiones puedan leer $env:
  - N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

```bash
docker compose up -d
```

> `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` es imprescindible: el workflow lee
> los secretos con `$env`, y por defecto las versiones recientes de n8n
> bloquean ese acceso.

Genera el secreto compartido una sola vez:

```bash
openssl rand -hex 32
```

Ese mismo valor va en `N8N_API_SECRET` (Vercel) y en
`ABOMINABLE_N8N_SECRET` (n8n). Si no coinciden, el claim devuelve 401.

## 2. Importar el workflow

1. n8n → **Workflows → Import from File**.
2. Elige `n8n/whatsapp-scheduler.json` de este repositorio.
3. El archivo **no contiene credenciales**: todo sale de `$env`.

## 3. Probarlo antes de activarlo

### a) El claim responde

Desde el VPS:

```bash
curl -X POST "$ABOMINABLE_APP_URL/api/n8n/messages/claim" \
  -H "Authorization: Bearer $ABOMINABLE_N8N_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"limit": 5, "worker": "prueba-manual"}'
```

Esperado con la cola vacía:

```json
{"data":{"count":0,"messages":[]}}
```

Si ves `401`, el secreto no coincide. Si ves `500`, revisa
`SUPABASE_SERVICE_ROLE_KEY` en Vercel.

> Cuidado: este comando **reclama de verdad**. Si hay un mensaje
> vencido, pasará a `processing` y ya no lo enviará el workflow. Pruébalo
> con la cola vacía o devuélvelo con
> `POST /api/n8n/messages/release?stale_minutes=1`.

### b) Una ejecución manual

1. Programa un mensaje en la app para dentro de 2 minutos, en mock mode.
2. Espera a que pase la hora.
3. En n8n pulsa **Execute Workflow**.
4. El mensaje debe quedar en `sent` con un `provider_message_id` que
   empieza por `wamid.MOCK-`.

### c) Activar

Cuando la prueba manual funcione, pon el workflow en **Active**. El
Schedule Trigger empieza a correr cada minuto.

## 4. Segundo workflow: el conserje

Un worker que muera después de reclamar deja el mensaje atrapado en
`processing`. Crea un workflow aparte, muy corto:

* **Schedule Trigger** — cada 10 minutos.
* **HTTP Request**
  * `POST {{ $env.ABOMINABLE_APP_URL }}/api/n8n/messages/release?stale_minutes=15`
  * Header `Authorization: Bearer {{ $env.ABOMINABLE_N8N_SECRET }}`

Devuelve cuántos mensajes recuperó. Sin esto, un fallo de infraestructura
deja mensajes varados para siempre.

## 5. Ajustes de producción

**Evitar ejecuciones solapadas.** El claim atómico ya impide el doble
envío aunque se solapen, pero solaparse igualmente desperdicia recursos.
En **Workflow → Settings**:

* *Timeout Workflow*: 120 segundos.
* *Save failed executions*: activado — es tu registro de diagnóstico.

**Si la cola crece.** Sube `limit` de 25 a 50-100 en el nodo *Claim due
messages*. El endpoint admite hasta 200 por llamada.

**Escalar a varios workers.** Puedes duplicar el workflow con otro
`worker` en el payload. Es seguro por diseño: `FOR UPDATE SKIP LOCKED`
reparte las filas y ninguno recibe la del otro.

## 6. Qué NO hacer

* **No actives `retryOnFail` en los nodos que llaman a Meta.** Un
  reintento de red puede entregar el mensaje dos veces. La reintentabilidad
  la decide la base de datos.
* **No des credenciales de Supabase a n8n.** Si n8n escribiera directo en
  las tablas, se saltaría la máquina de estados y el invariante de un
  solo envío dejaría de estar garantizado.
* **No cambies el estado del mensaje desde n8n.** Sólo reporta a
  `/sent` o `/failed` con su `claim_token`.

## 7. Diagnóstico

| Síntoma | Causa probable |
|---|---|
| `401` en el claim | `ABOMINABLE_N8N_SECRET` ≠ `N8N_API_SECRET` |
| `$env` llega vacío | Falta `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` |
| `count: 0` siempre | Los mensajes aún no vencen, o están en otro estado |
| Mensajes atascados en `processing` | El conserje no está corriendo |
| `sent` devuelve `applied: false` | El `claim_token` ya se consumió: no es un error, es la protección funcionando |
