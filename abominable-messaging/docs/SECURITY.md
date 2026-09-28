# Seguridad

## Modelo de amenazas

Lo que este sistema protege, en orden:

1. **Que nadie envíe mensajes en tu nombre.** Un atacante con acceso a la
   API de envío puede quemar tu número de WhatsApp y tu reputación.
2. **Que nadie lea tu lista de contactos.** Es información de clientes.
3. **Que nadie falsifique estados de entrega.** Un "entregado" falso te
   hace creer que un cliente recibió algo que nunca llegó.
4. **Que ningún mensaje salga dos veces.**

## Capas

### 1. Row Level Security

RLS está activo en las cinco tablas. **No existe ninguna política para el
rol `anon`**, así que un cliente sin sesión no lee ni escribe nada,
aunque tenga la anon key (que es pública por diseño).

Las políticas se evalúan contra `organization_members` mediante
`is_org_member()`, declarada `SECURITY DEFINER` para que la política de
esa misma tabla no recurra sobre sí misma.

`messages` tiene una restricción adicional: un usuario sólo puede
actualizar filas en `draft`, `scheduled`, `failed` o `cancelled`. Una fila
en `processing` o `sent` pertenece al pipeline de entrega y sólo es
escribible con la service-role key.

### 2. La service-role key nunca llega al navegador

Los módulos que la usan (`lib/env.ts`, `lib/supabase/admin.ts`,
`services/whatsapp/client.ts`) importan `server-only`. Importarlos desde
un componente cliente **rompe el build**. No es una convención que haya
que recordar: es un error de compilación.

Sólo la usan dos familias de rutas, y ambas autentican antes:

* `/api/n8n/*` — bearer `N8N_API_SECRET`
* `/api/webhooks/whatsapp` — firma HMAC de Meta

### 3. Autenticación de usuario

Supabase Auth con email y contraseña (mínimo 8 caracteres).

`src/proxy.ts` refresca la sesión y redirige a `/login` a quien no la
tenga. Usa `getUser()`, **no** `getSession()`: el primero revalida el JWT
contra Supabase, el segundo se fía de la cookie que traiga el navegador.

El proxy es defensa en profundidad, no la frontera de seguridad. Aunque
alguien lo esquivara, RLS seguiría impidiendo leer datos ajenos.

Las rutas bajo `/api/` quedan exentas del redirect: devuelven un 401 JSON
desde su propio handler, porque mandar a un cliente de API una página
HTML de login no le sirve de nada.

El error de login es genérico a propósito («Credenciales incorrectas»):
distinguir «no existe» de «contraseña incorrecta» permite enumerar
cuentas.

### 4. Endpoints de n8n

`Authorization: Bearer <N8N_API_SECRET>` comparado con `timingSafeEqual`.
La comparación ingenua con `===` filtra información por el tiempo de
ejecución.

Si `N8N_API_SECRET` no está configurada, el guard **falla cerrado**:
devuelve 401, nunca abre el endpoint.

Genera el secreto con:

```bash
openssl rand -hex 32
```

### 5. Firma del webhook

Meta firma el **cuerpo crudo** con el App Secret y lo envía en
`X-Hub-Signature-256`. Verificamos con HMAC-SHA256 en tiempo constante,
**antes** de parsear el JSON: re-serializar un objeto ya parseado cambia
los bytes y la firma jamás coincidiría.

Sin `META_APP_SECRET` configurado:

* En **mock mode** se aceptan POSTs sin firma (desarrollo local).
* Fuera de mock mode el endpoint responde **503**. Aceptar callbacks sin
  firmar permitiría a cualquiera marcar cualquier mensaje como entregado.

El handshake GET compara `hub.verify_token` también en tiempo constante.

### 6. Validación de entrada

Todos los cuerpos se parsean con Zod antes de tocar la base de datos. Los
teléfonos se normalizan a E.164 y se validan tres veces: en el navegador
(UX), en el servidor (autoridad) y en un `CHECK` de Postgres (última
línea).

Los términos de búsqueda se limpian de los metacaracteres de PostgREST
(`% _ , ( )`) antes de interpolarse en un filtro `or`.

## Gestión de secretos

| Variable | Sensibilidad | Si se filtra |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Pública | Nada |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Pública por diseño | Nada, RLS protege |
| `SUPABASE_SERVICE_ROLE_KEY` | **Crítica** | Acceso total a los datos → rota ya |
| `WHATSAPP_ACCESS_TOKEN` | **Crítica** | Envío en tu nombre → revoca el System User |
| `META_APP_SECRET` | **Crítica** | Webhooks falsificados → regenera en Meta |
| `N8N_API_SECRET` | **Alta** | Reclamar y marcar mensajes → rota en ambos lados |
| `WHATSAPP_VERIFY_TOKEN` | Media | Sólo afecta al handshake inicial |

Reglas:

* `.env`, `.env.local` y `.env.*` están en `.gitignore`. Sólo
  `.env.example` se versiona, y nunca contiene valores.
* En Vercel, los secretos van como *Environment Variables*, separados por
  entorno (Development / Preview / Production).
* Ningún secreto lleva el prefijo `NEXT_PUBLIC_`. Ese prefijo significa
  «esto va al bundle del navegador».

### Si se filtra algo

1. **Supabase service role:** Settings → API → *Reset service role key*.
   Actualiza Vercel y redeploy.
2. **Token de WhatsApp:** Business Settings → System Users → revoca el
   token, genera otro.
3. **App Secret:** App Settings → Basic → *Reset App Secret*. Vuelve a
   configurar el webhook.
4. **N8N_API_SECRET:** genera uno nuevo y actualízalo **en los dos sitios
   a la vez** (Vercel y n8n), o el claim empezará a dar 401.

## Mock mode en producción

`WHATSAPP_MOCK_MODE=true` en producción es legítimo (una pasada en seco),
pero **nunca silencioso**: el dashboard muestra una franja ámbar fija y
`/settings` lo marca. Los ids simulados llevan el prefijo
`wamid.MOCK-`, así que un envío falso no puede confundirse con uno real
ni en la UI ni en la base de datos.

## Lo que este sistema NO hace

* No usa WhatsApp Web, Puppeteer ni librerías no oficiales. Sólo la Cloud
  API oficial.
* No intenta sortear la ventana de 24 horas.
* No guarda contraseñas: eso es responsabilidad de Supabase Auth.
* No registra el contenido de los mensajes en los logs de la aplicación.

## Pendiente (fuera del MVP)

* Rate limiting por IP en los endpoints públicos (Vercel lo ofrece; un
  atacante hoy sólo puede provocar 401 repetidos).
* Rotación automática del token de WhatsApp antes de que caduque.
* Auditoría de acceso a nivel de usuario (hoy `message_events` registra
  el actor, no cada lectura).
* 2FA en el login.
