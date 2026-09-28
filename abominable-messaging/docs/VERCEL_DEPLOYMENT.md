# Despliegue en Vercel

> **Estado actual:** el proyecto **no** se ha desplegado desde esta
> sesión. La CLI de Vercel no está instalada ni autenticada en el entorno
> donde se construyó, así que no existe ninguna URL de Preview ni de
> Production todavía. Lo que sigue son los pasos exactos para hacerlo tú.

## Requisito previo

El proyecto vive en el subdirectorio **`abominable-messaging/`** del
repositorio. Esto es importante: hay que decírselo a Vercel.

## Opción A — desde el dashboard (recomendada)

1. <https://vercel.com/new> → **Import Git Repository** → elige este
   repositorio.
2. **Root Directory** → *Edit* → escribe `abominable-messaging`.
   Sin esto, el build falla: en la raíz no hay `package.json`.
3. Framework Preset: **Next.js** (se detecta solo).
4. Build Command / Output: déjalos por defecto.
5. Añade las variables de entorno (sección siguiente) **antes** del
   primer deploy.
6. **Deploy.**

## Opción B — desde la CLI

```bash
npm install -g vercel
vercel login

cd abominable-messaging
vercel link          # crea el proyecto
vercel               # Preview deployment
vercel --prod        # Production
```

Al ejecutar `vercel link` desde dentro de la carpeta, el Root Directory
queda configurado correctamente.

## Variables de entorno

En **Project Settings → Environment Variables**. Vercel distingue tres
entornos y conviene separarlos de verdad.

| Variable | Development | Preview | Production |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | proyecto de pruebas | proyecto de pruebas | proyecto real |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✔ | ✔ | ✔ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✔ | ✔ | ✔ |
| `N8N_API_SECRET` | ✔ | secreto propio | secreto propio |
| `WHATSAPP_ACCESS_TOKEN` | placeholder | placeholder | token permanente |
| `WHATSAPP_PHONE_NUMBER_ID` | placeholder | placeholder | real |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | placeholder | placeholder | real |
| `WHATSAPP_VERIFY_TOKEN` | ✔ | ✔ | ✔ |
| `META_APP_SECRET` | — | — | **obligatorio** |
| `WHATSAPP_MOCK_MODE` | `true` | `true` | `false` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | URL del preview | dominio final |

Dos reglas que no conviene romper:

* **Preview siempre en mock.** Cada pull request genera un deployment; si
  Preview tuviera credenciales reales, un branch cualquiera podría enviar
  mensajes de verdad a clientes de verdad.
* **`META_APP_SECRET` es obligatoria en producción.** Sin ella el webhook
  responde 503 fuera de mock mode, a propósito: aceptar callbacks sin
  firmar permitiría a cualquiera falsificar estados de entrega.

> Lo ideal es un **proyecto de Supabase distinto** para Preview, para que
> las pruebas no escriban en los datos reales. Si por ahora compartes el
> mismo, al menos mantén Preview en mock mode.

## Verificación tras el Preview deployment

```bash
BASE=https://tu-preview.vercel.app

# La raíz redirige a /login
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $BASE/

# La página de login carga
curl -s -o /dev/null -w "%{http_code}\n" $BASE/login

# El dashboard está protegido (307 -> /login)
curl -s -o /dev/null -w "%{http_code}\n" $BASE/dashboard

# La API responde 401 JSON, no una página HTML
curl -s $BASE/api/contacts

# n8n rechaza sin bearer
curl -s -X POST $BASE/api/n8n/messages/claim \
  -H 'content-type: application/json' -d '{"limit":1}'

# El handshake del webhook funciona
curl -s "$BASE/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=OK123"
```

Esperado:

| Comprobación | Resultado |
|---|---|
| `/` | `307` → `/login` |
| `/login` | `200` |
| `/dashboard` | `307` → `/login?next=/dashboard` |
| `/api/contacts` | `{"error":{"code":"unauthorized",...}}` |
| `/api/n8n/messages/claim` | `{"error":{"code":"unauthorized",...}}` |
| webhook verify | `OK123` |

Después, en el navegador: regístrate, entra, crea un contacto, programa
un mensaje y confirma que la hora mostrada coincide con la que tecleaste.

**Revisa también los build logs.** Deben terminar en `✓ Compiled
successfully` y no contener ningún valor de secreto.

## Pasar a producción

Cuando el preview esté verificado:

```bash
vercel --prod
```

o *Promote to Production* desde el dashboard.

Después:

1. Actualiza `NEXT_PUBLIC_APP_URL` al dominio definitivo y redeploy (se
   usa para construir la URL del webhook que registras en Meta).
2. Registra el webhook en Meta apuntando a
   `https://tu-dominio/api/webhooks/whatsapp`.
3. Actualiza `ABOMINABLE_APP_URL` en n8n.
4. Pon `WHATSAPP_MOCK_MODE=false` **sólo** cuando el token permanente
   esté en su sitio y hayas hecho una prueba con tu propio número.

## Notas operativas

* **Las variables se leen en arranque.** Cambiar una exige redeploy.
* **Todas las rutas del dashboard son dinámicas** (`force-dynamic`): leen
  la sesión, así que no se pueden prerenderizar. Es correcto.
* **No hay cron de Vercel.** El reloj es n8n, en tu VPS. Si algún día
  quisieras prescindir de n8n, un Vercel Cron podría llamar al claim,
  pero su granularidad mínima es de un minuto y en el plan gratuito, de
  un día.
* **Región:** elige `iad1` o `gru1` para quedar cerca de Supabase si lo
  creaste en `us-east-1`.

## Si el build falla

| Error | Causa |
|---|---|
| `No package.json found` | Falta configurar **Root Directory** = `abominable-messaging` |
| `Missing required environment variable` | Falta una variable en ese entorno concreto |
| `Module not found: server-only` | Un componente cliente está importando un módulo de servidor |
