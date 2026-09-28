# Testing

```bash
npm run test        # suite completa
npm run test:watch  # modo watch
npm run verify      # lint + typecheck + test + build
```

Runner: **Vitest**, entorno `node`.

## Filosofía

No buscamos cobertura alta por la cobertura. Buscamos que **lo que puede
hacer daño esté probado**: dinero, mensajes duplicados, zonas horarias y
autenticación. La UI se verifica a mano.

## Qué está cubierto — 144 pruebas en 7 archivos

### `tests/phone.test.ts` (15)
Validación y normalización E.164. Incluye los casos donde la
normalización **debe negarse a adivinar**: `+9981234567` ya es un E.164
válido y no debe reescribirse a `+529981234567`.

### `tests/datetime.test.ts` (22)
Conversión de zonas horarias. Cancún (UTC−5 fijo desde que México
eliminó el horario de verano), zonas con DST en invierno y en verano,
medianoche, cambios de día, y un round-trip `wall clock → UTC → wall
clock` en seis combinaciones.

### `tests/validation.test.ts` (21)
Esquemas de Zod: alta de contacto, creación y programación de mensajes,
rechazo de fechas pasadas, coherencia texto/plantilla, reprogramación
(fecha y hora deben ir juntas) y credenciales.

### `tests/whatsapp.test.ts` (19)
Construcción del payload de la Cloud API — incluido el orden **numérico**
de las variables de plantilla, para que `{{10}}` no se cuele delante de
`{{2}}` —, clasificación de errores retryable/permanente, transporte mock
y verificación de la firma HMAC de Meta (cuerpo alterado, secreto
incorrecto, algoritmo inesperado, secreto ausente).

### `tests/scheduler.test.ts` (24)
El corazón del sistema:

* Claim atómico: un mensaje se entrega a **un solo** llamador.
* Doble envío: un token consumido no vuelve a aplicar.
* Un `dispatch` repetido produce **un solo** evento `message_sent`.
* Reintentos acotados: tras agotar `max_attempts` el mensaje termina en
  `failed`, nunca en bucle.
* Recuperación de claims huérfanos.
* Webhook: `sent → delivered → read`, sin regresiones cuando los eventos
  llegan desordenados, e idempotente ante repeticiones.

### `tests/api-auth.test.ts` (9)
Comparación en tiempo constante y el guard bearer de `/api/n8n/*`:
secreto correcto, incorrecto, ausente, esquema equivocado, token vacío y
`bearer` en minúsculas (RFC 7235 lo exige insensible a mayúsculas).

### `tests/routes.test.ts` (34)
Los route handlers **de verdad**: mismo `Request` de entrada, mismo
`Response` y mismo código de estado de salida. Sólo los dos clientes de
Supabase están sustituidos por dobles en memoria.

* Protección de sesión: 401 en contactos y mensajes, sin filtrar filas.
* Contactos: alta con normalización, rechazo de teléfono y nombre
  inválidos, búsqueda, edición, borrado.
* Mensajes: programar sin despachar, guardar el instante en **UTC** (09:00
  Cancún → 14:00Z), envío inmediato en mock, rechazo de fecha pasada y de
  JSON malformado.
* Reprogramar y cancelar, incluido el 409 al intentar tocar un mensaje ya
  `sent` o `processing`.
* Claim de n8n: 401 sin bearer, y `count: 0` en el segundo intento.
* Webhook: handshake correcto/incorrecto, aplicación de estado, cuerpo
  ilegible y provider id desconocido.

## Qué NO está cubierto, y por qué

**Honestidad sobre el límite principal:** `tests/helpers/fake-db.ts`
reimplementa en memoria el *contrato* de las funciones SQL. Eso prueba
que el TypeScript que depende de ese contrato se comporta bien, pero
**no** prueba que Postgres lo cumpla bajo concurrencia real. La garantía
de "un solo envío" la da `FOR UPDATE SKIP LOCKED`, y verificarla exige una
base de datos de verdad.

Para comprobarlo contra Supabase real, con dos claims simultáneos:

```sql
-- Sesión A y sesión B, a la vez:
select * from public.claim_due_messages(10, 'worker-a');
select * from public.claim_due_messages(10, 'worker-b');
-- Ningún id debe aparecer en las dos salidas.
```

Otros huecos conocidos:

* **Políticas RLS**: se verifican a mano con la anon key (ver
  `SUPABASE_SETUP.md`, sección 4).
* **Componentes React**: sin tests de render. La UI se revisa
  manualmente; la lógica que importa ya está extraída a `lib/`.
* **End-to-end con Meta**: requiere credenciales reales. La checklist
  manual está en `WHATSAPP_SETUP.md`, sección 9.

## Recorrido manual antes de desplegar

1. `/login` carga y rechaza credenciales inválidas.
2. `/dashboard` sin sesión redirige a `/login`.
3. Crear un contacto con `998 123 4567` → se guarda `+529981234567`.
4. Programar un mensaje para dentro de 2 minutos.
5. Verificar en `/scheduled` que la hora mostrada es la que tecleaste.
6. Reprogramar y confirmar que cambia.
7. Cancelar y confirmar que pasa a `cancelled`.
8. Enviar uno inmediato en mock → `sent` con `wamid.MOCK-`.
9. Abrir el detalle y revisar la línea de tiempo de auditoría.
10. Comprobar la franja de mock mode si estás en producción.
