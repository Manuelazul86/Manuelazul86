# Supabase — puesta en marcha

Tiempo estimado: 15 minutos. Ninguna migración se ejecuta sola: tú
decides cuándo aplicarlas.

## 1. Crear el proyecto

1. Entra a <https://supabase.com/dashboard> y pulsa **New project**.
2. Nombre: `abominable-messaging`. **Crea un proyecto nuevo, no reutilices
   uno existente** — este sistema debe quedar aislado del resto.
3. Región: la más cercana a Cancún (`us-east-1`).
4. Guarda la contraseña de la base de datos en tu gestor de contraseñas.

## 2. Copiar las credenciales

**Settings → API**:

| En Supabase | En `.env.local` |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` |

> La `service_role` key ignora RLS por completo. Si alguna vez aparece en
> el navegador, en un repositorio o en un log, **rótala de inmediato**.

## 3. Aplicar las migraciones

Los cuatro archivos de `supabase/migrations/` se aplican **en orden**:

| Archivo | Qué hace |
|---|---|
| `20260928000100_init_core.sql` | Tablas, enums, índices, triggers |
| `20260928000200_rls.sql` | Row Level Security y políticas |
| `20260928000300_scheduler_rpc.sql` | Claim atómico y transiciones de estado |
| `20260928000400_bootstrap.sql` | Alta de organización en el primer login |

### Opción A — SQL Editor (la más simple)

Para cada archivo, en orden: **SQL Editor → New query**, pega el
contenido completo, **Run**. Verifica que termina sin errores antes de
pasar al siguiente.

### Opción B — Supabase CLI

```bash
npm install -g supabase
supabase login
supabase link --project-ref <tu-project-ref>
supabase db push
```

`db push` aplica sólo lo que falte, así que es seguro repetirlo.

## 4. Comprobar que quedó bien

En el SQL Editor:

```sql
-- Deben aparecer las 5 tablas, todas con rowsecurity = true
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- Deben aparecer las 8 funciones del pipeline
select proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in (
    'claim_due_messages', 'claim_message_by_id', 'mark_message_sent',
    'mark_message_failed', 'release_stuck_messages',
    'apply_provider_status', 'bootstrap_organization', 'log_message_event'
  )
order by proname;
```

Prueba de humo de que RLS realmente bloquea a un anónimo — desde una
terminal, con la **anon** key:

```bash
curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/messages?select=*" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
# Debe devolver [] — nunca filas.
```

## 5. Autenticación

**Authentication → Providers → Email**: déjalo habilitado.

* **Desarrollo:** desactiva *Confirm email* para poder entrar de
  inmediato tras registrarte.
* **Producción:** actívalo.

**Authentication → URL Configuration**: añade tu dominio de Vercel a
*Site URL* y a *Redirect URLs*.

### Crear tu usuario

Regístrate en `/signup` desde la app. En el primer inicio de sesión la
app llama a `bootstrap_organization()` y te crea la organización
«Abominable» con zona `America/Cancun`, contigo como `owner`.

Si prefieres crear el usuario a mano: **Authentication → Users → Add
user**, y la organización se creará igual al entrar.

## 6. Mantenimiento recomendado

`release_stuck_messages()` recupera mensajes que quedaron atrapados en
`processing` porque el worker murió. Se invoca desde
`POST /api/n8n/messages/release` (ver `N8N_SETUP.md`), o puedes
programarlo dentro de Postgres si tu plan incluye `pg_cron`:

```sql
select cron.schedule(
  'release-stuck-messages',
  '*/10 * * * *',
  $$ select public.release_stuck_messages(15) $$
);
```

## 7. Notas sobre el esquema

* **Nada destructivo.** Las migraciones sólo crean; no hay `DROP TABLE`
  ni `DELETE`. Volver a ejecutarlas es seguro.
* **`contacts`** tiene un índice único `(organization_id, phone)`: el
  mismo número no puede duplicarse dentro de una organización.
* **`messages.phone`** lleva un `CHECK` de E.164 — la validación de la
  app y la de la base de datos son la misma regla.
* **`message_events`** es sólo-lectura para los usuarios: la auditoría se
  escribe exclusivamente desde el servidor.
