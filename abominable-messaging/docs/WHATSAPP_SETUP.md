# WhatsApp Business Cloud API — configuración

Usamos **exclusivamente la API oficial de Meta**. No hay WhatsApp Web, ni
Puppeteer, ni librerías no oficiales: esos caminos violan los términos de
servicio y acaban con el número bloqueado.

Mientras no tengas credenciales, deja `WHATSAPP_MOCK_MODE=true` y el
sistema completo (programar, reclamar, enviar, auditar) funciona
simulando el transporte.

## 1. Requisitos previos

* Una cuenta de **Meta Business** verificada.
* Un **número de teléfono** que no esté registrado en la app normal de
  WhatsApp ni en WhatsApp Business. Si lo está, primero hay que borrar
  esa cuenta desde el teléfono.
* Una tarjeta para el método de pago del WABA (Meta cobra por
  conversación; hay un tramo gratuito mensual).

## 2. Crear la app

1. <https://developers.facebook.com/apps> → **Create App**.
2. Caso de uso: **Other** → tipo **Business**.
3. Asocia la app a tu Business Manager.
4. En el panel de la app: **Add product → WhatsApp → Set up**.

## 3. Obtener las variables

En **WhatsApp → API Setup**:

| Dato en Meta | Variable |
|---|---|
| Phone number ID | `WHATSAPP_PHONE_NUMBER_ID` |
| WhatsApp Business Account ID | `WHATSAPP_BUSINESS_ACCOUNT_ID` |
| Temporary access token | `WHATSAPP_ACCESS_TOKEN` |

> Ojo: `WHATSAPP_PHONE_NUMBER_ID` es el **ID numérico**, no el número de
> teléfono.

En **App Settings → Basic**:

| Dato en Meta | Variable |
|---|---|
| App Secret (**Show**) | `META_APP_SECRET` |

Y una que inventas tú:

```bash
openssl rand -hex 32   # -> WHATSAPP_VERIFY_TOKEN
```

## 4. Token permanente (obligatorio para producción)

El token de API Setup **caduca en 24 horas**. Para producción:

1. <https://business.facebook.com/settings/system-users> → **Add**.
2. Nombre: `abominable-messaging`, rol **Admin**.
3. **Add Assets** → tu WhatsApp Business Account → activa *Manage*.
4. **Generate New Token** → elige la app → permisos:
   * `whatsapp_business_messaging`
   * `whatsapp_business_management`
5. Copia el token (sólo se muestra una vez) a `WHATSAPP_ACCESS_TOKEN`.

## 5. Registrar el webhook

Necesitas la app desplegada con HTTPS (`NEXT_PUBLIC_APP_URL`).

1. **WhatsApp → Configuration → Webhook → Edit**.
2. **Callback URL:** `https://tu-dominio.vercel.app/api/webhooks/whatsapp`
3. **Verify token:** el mismo valor de `WHATSAPP_VERIFY_TOKEN`.
4. **Verify and save.** Meta hace un GET; nuestro endpoint compara el
   token en tiempo constante y devuelve el `hub.challenge`.
5. En **Webhook fields**, suscríbete a **`messages`**. Ese campo incluye
   los `statuses` (sent / delivered / read / failed), que es lo que
   consumimos hoy.

Para probar la verificación sin Meta:

```bash
curl "https://tu-dominio/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=12345"
# Debe responder: 12345
```

## 6. La regla de las 24 horas

Esto no es un detalle técnico, es la política que gobierna qué puedes
enviar:

| Situación | Qué puedes mandar |
|---|---|
| El contacto te escribió hace menos de 24 h | **Mensaje de sesión**: texto libre |
| Han pasado más de 24 h, o nunca te escribió | **Sólo plantilla aprobada** |

Cada mensaje entrante del cliente reinicia la ventana.

Si envías texto libre fuera de la ventana, Meta responde con el error
**131047** (*Re-engagement message*). Nuestro clasificador lo marca como
**permanente**: no se reintenta, porque reintentar fallaría igual y
consumiría cuota.

El sistema **no intenta evadir esta regla de ninguna forma.** La
arquitectura distingue los dos tipos (`message_type: 'text' | 'template'`)
para que uses el correcto, no para sortear la política.

## 7. Plantillas

Se crean y se aprueban en **WhatsApp Manager → Message Templates**. El
MVP no incluye editor de plantillas: aquí sólo se referencian por
`template_name`, `template_language` y variables.

Las variables son posicionales y empiezan en 1. Si la plantilla dice:

> Hola {{1}}, tu cita es el {{2}}.

en el compositor pones:

```json
{ "1": "Karla", "2": "lunes a las 3pm" }
```

El servicio las ordena numéricamente antes de enviarlas, así que `{{10}}`
no se cuela delante de `{{2}}`.

La aprobación suele tardar de minutos a 24 horas. Una plantilla
rechazada produce el error **132001** (permanente).

## 8. Errores frecuentes

| Código | Significado | ¿Reintenta? |
|---|---|---|
| 190 | Token caducado o inválido | No — genera uno permanente |
| 131026 | El destinatario no puede recibir mensajes | No |
| 131047 | Fuera de la ventana de 24 h: hace falta plantilla | No |
| 132001 | La plantilla no existe o no está aprobada | No |
| 130429 | Límite de velocidad de la Cloud API | Sí, con backoff |
| 131016 | Servicio temporalmente no disponible | Sí |

La tabla completa vive en `src/services/whatsapp/errors.ts`, que es lo
que decide si un fallo vuelve a la cola o termina en `failed`.

## 9. Pasar de mock a real

1. Rellena las cinco variables de WhatsApp.
2. Cambia `WHATSAPP_MOCK_MODE=false`.
3. Reinicia (o redeploy en Vercel: las variables se leen en arranque).
4. Manda un mensaje de prueba a tu propio número. Escríbele tú primero
   desde ese teléfono al número del negocio, para abrir la ventana de
   24 h y poder usar texto libre.
5. En el detalle del mensaje, comprueba que `provider_message_id` empieza
   por `wamid.` y **no** por `wamid.MOCK-`.
