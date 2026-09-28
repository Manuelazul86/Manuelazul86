# Paso a paso — de cero a enviando

Checklist ordenada. Cada bloque dice **quién lo hace**: 🧑 tú (requiere
cuenta, navegador o tarjeta) o 🤖 Claude (código, configuración, pruebas).

El orden importa: cada fase desbloquea la siguiente.

---

## FASE 0 — Lo que ya está hecho 🤖

- Código completo en la rama `claude/abominable-messaging-mvp-wbjawm`
- 4 migraciones SQL + un archivo de instalación de un solo paso
- Workflow de n8n listo para importar
- 144 tests pasando, lint / typecheck / build en verde
- Documentación completa

**Nada de esto sirve todavía** porque falta la base de datos. Empezamos ahí.

---

## FASE 1 — Supabase (20 min) 🧑

Sin esto no funciona nada más. Es el paso que desbloquea todo.

### 1.1 Crear el proyecto
1. <https://supabase.com> → **Start your project** (gratis, con GitHub)
2. **New project**
   - Name: `abominable-messaging`
   - Database password: genérala y **guárdala en tu gestor**
   - Region: **East US (North Virginia)** — la más cercana a Cancún
3. Espera ~2 minutos a que termine de crearse

> Proyecto **nuevo**. No reutilices el de ningún otro proyecto tuyo.

### 1.2 Instalar el esquema
1. Menú lateral → **SQL Editor** → **New query**
2. Abre `abominable-messaging/supabase/setup-all.sql` de este repo
3. Copia **todo** el archivo y pégalo
4. **Run**
5. Debe decir `Success. No rows returned`

### 1.3 Comprobar que quedó
Nueva query, pega esto y Run:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

Deben salir 5 filas — `contacts`, `message_events`, `messages`,
`organization_members`, `organizations` — **todas con `rowsecurity = true`**.
Si alguna sale en `false`, algo falló: avísame.

### 1.4 Copiar las 3 llaves
**Settings → API**. Apunta estos tres valores (los pegarás en Vercel):

| En Supabase | Variable |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` |

> La `service_role` es la llave maestra: ignora toda la seguridad.
> Va **sólo** en Vercel. Nunca en un chat, un correo ni el repo.

### 1.5 Auth para empezar
**Authentication → Providers → Email**: déjalo activado y **desactiva
"Confirm email"** por ahora, para poder entrar de inmediato. Lo vuelves
a activar antes de producción real.

✅ **Fase 1 lista cuando:** ves las 5 tablas y tienes las 3 llaves apuntadas.

---

## FASE 2 — Vercel (15 min) 🧑

### 2.1 Importar
1. <https://vercel.com/new>
2. Importa el repositorio `Manuelazul86/Manuelazul86`
3. **Branch:** `claude/abominable-messaging-mvp-wbjawm`

### 2.2 ⚠️ EL PASO QUE MÁS SE OLVIDA
**Root Directory** → **Edit** → escribe:

```
abominable-messaging
```

Sin esto el build falla con `No package.json found`. El proyecto vive en
una subcarpeta para no ensuciar la raíz del repo.

### 2.3 Variables de entorno
Antes de dar Deploy, pega estas (yo te doy los dos secretos abajo):

```
NEXT_PUBLIC_SUPABASE_URL      = (de Supabase 1.4)
NEXT_PUBLIC_SUPABASE_ANON_KEY = (de Supabase 1.4)
SUPABASE_SERVICE_ROLE_KEY     = (de Supabase 1.4)
N8N_API_SECRET                = (te lo genero yo)
WHATSAPP_VERIFY_TOKEN         = (te lo genero yo)
WHATSAPP_ACCESS_TOKEN         = pendiente
WHATSAPP_PHONE_NUMBER_ID      = pendiente
WHATSAPP_MOCK_MODE            = true
NEXT_PUBLIC_APP_URL           = https://loquesea.vercel.app
```

`WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` pon literalmente
`pendiente`: en mock mode no se usan, pero la app espera que existan.

### 2.4 Deploy
**Deploy**. Tarda 1-2 minutos. Cuando termine, **pásame la URL**.

### 2.5 Ajustar la URL
La URL real te la da Vercel al terminar. Vuelve a
**Settings → Environment Variables**, corrige `NEXT_PUBLIC_APP_URL` con
la URL real, y **Redeploy**.

✅ **Fase 2 lista cuando:** me pasas la URL y yo verifico los endpoints.

---

## FASE 3 — Probar en mock (10 min) 🧑 + 🤖

🤖 Yo verifico por fuera que las rutas y la seguridad respondan bien.

🧑 Tú, en el navegador:
1. Entra a `tu-url.vercel.app` → te manda a `/login`
2. **Crear cuenta** → tu email y una contraseña de 8+ caracteres
3. Entras al dashboard. Tu organización se crea sola.
4. **Contactos → Nuevo contacto**
   - Nombre: Karla
   - Teléfono: escribe `998 123 4567` (sin +52, a propósito)
   - Guarda → debe quedar como **`+529981234567`**
5. **Nuevo mensaje** → elige a Karla → escribe algo → **Enviar ahora**
6. Debe quedar en **Enviado**, con un ID que empieza por `wamid.MOCK-`
7. Abre el detalle → revisa la línea de tiempo de auditoría
8. Programa otro para dentro de 5 minutos → **Programar**
9. Ve a **Programados** → pruébale **Reprogramar** y **Cancelar**

✅ **Fase 3 lista cuando:** todo el flujo funciona en simulación.
En este punto el sistema está **probado de punta a punta sin gastar un
peso ni tocar Meta**.

---

## FASE 4 — n8n en Neubox (20 min) 🧑

⚠️ **Antes de nada: verifica qué plan tienes.**

n8n necesita Node.js corriendo permanentemente o Docker. Eso **sólo
funciona en VPS o Cloud**, no en hosting compartido.

| Plan de Neubox | ¿Sirve para n8n? |
|---|---|
| Hosting compartido | ❌ No |
| VPS / Cloud | ✅ Sí |

Cómo saberlo: si entras por **SSH** y puedes correr `docker ps` o
`node -v`, es VPS. Si sólo tienes cPanel, es compartido.

**Si es compartido**, hay tres salidas, y la tercera es la que yo
recomiendo:
1. Subir a VPS en Neubox
2. n8n Cloud (~€20/mes)
3. **Contratar un VPS de $5-6/mes** (Hetzner, DigitalOcean, Contabo) —
   sale más barato que n8n Cloud y te sirve también para los demás
   proyectos de Abominable

### 4.1 Variables en el VPS
En el `docker-compose.yml` de n8n:

```yaml
environment:
  - ABOMINABLE_APP_URL=https://tu-url.vercel.app
  - ABOMINABLE_N8N_SECRET=(el mismo N8N_API_SECRET de Vercel)
  - WHATSAPP_ACCESS_TOKEN=pendiente
  - WHATSAPP_PHONE_NUMBER_ID=pendiente
  - WHATSAPP_API_VERSION=v21.0
  - N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

```bash
docker compose up -d
```

> `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` es obligatorio. Sin eso el
> workflow no puede leer los secretos y todo falla con 401.

### 4.2 Importar
n8n → **Workflows → Import from File** → `n8n/whatsapp-scheduler.json`

### 4.3 Probar
Desde el VPS:

```bash
curl -X POST "$ABOMINABLE_APP_URL/api/n8n/messages/claim" \
  -H "Authorization: Bearer $ABOMINABLE_N8N_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"limit": 5, "worker": "prueba"}'
```

Esperado con la cola vacía: `{"data":{"count":0,"messages":[]}}`
Si sale `401`, el secreto no coincide entre Vercel y n8n.

### 4.4 Activar
Programa un mensaje para dentro de 2 minutos, espera, y pon el workflow
en **Active**. A los 60 segundos debe salir solo.

✅ **Fase 4 lista cuando:** un mensaje programado se envía sin que tú
toques nada.

---

## FASE 5 — WhatsApp real (30-45 min) 🧑

Sólo después de que las fases 1-4 estén verdes.

### 5.1 Requisitos
- Meta Business verificado
- **Un número que NO esté en WhatsApp ni WhatsApp Business.** Si lo está,
  bórralo primero desde el teléfono. No uses tu número personal.
- Tarjeta para el método de pago del WABA

### 5.2 Crear la app
1. <https://developers.facebook.com/apps> → **Create App**
2. Caso de uso **Other** → tipo **Business**
3. **Add product → WhatsApp → Set up**

### 5.3 Token permanente
El token de prueba **caduca en 24 h**. Para producción:
1. <https://business.facebook.com/settings/system-users> → **Add**
2. Rol **Admin**, nombre `abominable-messaging`
3. **Add Assets** → tu WABA → activa *Manage*
4. **Generate New Token** → permisos `whatsapp_business_messaging` y
   `whatsapp_business_management`
5. Cópialo — **sólo se muestra una vez**

### 5.4 Variables
Actualiza en Vercel **y** en n8n:
- `WHATSAPP_ACCESS_TOKEN` (el permanente)
- `WHATSAPP_PHONE_NUMBER_ID` (el **ID numérico**, no el teléfono)
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `META_APP_SECRET` (App Settings → Basic → Show) — **obligatorio**

### 5.5 Webhook
**WhatsApp → Configuration → Webhook → Edit**
- Callback URL: `https://tu-url.vercel.app/api/webhooks/whatsapp`
- Verify token: tu `WHATSAPP_VERIFY_TOKEN`
- **Verify and save**
- En **Webhook fields** suscríbete a **`messages`**

### 5.6 Encender
1. `WHATSAPP_MOCK_MODE=false` en Vercel → **Redeploy**
2. **Desde tu teléfono personal, escríbele al número del negocio.** Eso
   abre la ventana de 24 h y te deja mandar texto libre.
3. Manda un mensaje de prueba a tu propio número
4. El `provider_message_id` debe empezar por `wamid.` y **no** por
   `wamid.MOCK-`
5. Marca como leído en el teléfono → en el dashboard debe pasar a
   **Leído** en segundos. Eso confirma que el webhook funciona.

✅ **Listo. Estás enviando de verdad.**

---

## Recordatorio: la regla de 24 horas

| Situación | Qué puedes mandar |
|---|---|
| El contacto te escribió hace < 24 h | Texto libre |
| Pasaron > 24 h, o nunca te escribió | **Sólo plantilla aprobada** |

Si mandas texto libre fuera de la ventana, Meta devuelve error 131047 y
el mensaje queda en **Fallido**. No es un bug: es la política.

Las plantillas se crean y aprueban en **WhatsApp Manager → Message
Templates** (tarda de minutos a 24 h). Aquí sólo se referencian por
nombre, idioma y variables.

---

## Qué hago yo en cada fase

| Fase | Yo puedo |
|---|---|
| 1 Supabase | Interpretar cualquier error del SQL y corregir las migraciones |
| 2 Vercel | Leer los build logs que me pegues y arreglar lo que falle |
| 3 Mock | Verificar endpoints y seguridad por fuera con la URL pública |
| 4 n8n | Ajustar el workflow JSON a tu instalación concreta |
| 5 WhatsApp | Traducir los códigos de error de Meta y ajustar la clasificación |

Lo que **no** puedo: entrar a Supabase, Vercel, Meta o Neubox. No tengo
navegador ni tus credenciales en esta sesión. Todo lo que requiera un
login lo tienes que hacer tú — pero cada paso está escrito arriba.
