# Puesta en marcha con datos reales

Guía para pasar de la demo local a operar el portafolio real de marcas en Metricool, con
inicio de sesión con Google. Complementa `LOCAL_DEVELOPMENT.md`, que cubre el modo demo.

El orden importa: identidad primero, luego lectura real, y solo al final envíos.

## 1. Secretos que debe colocar el equipo

Estos valores no se versionan y no deben pegarse en ningún documento. Van únicamente
en `.env` local o en el gestor de secretos del entorno.

| Variable | Origen | Notas |
| --- | --- | --- |
| `METRICOOL_API_TOKEN` | Cuenta Metricool autorizada | Es el mismo token que usa METRIQ en `METRICOOL_USER_TOKEN`. Viaja en el header `X-Mc-Auth`. |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud → APIs y servicios → Credenciales | Cliente OAuth de tipo **Aplicación web**. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | El mismo cliente OAuth | Secreto: solo vive en el servidor. |
| `SAC_FLOW_AUTH_SESSION_SECRET` | Generado por el equipo (32+ caracteres aleatorios) | Firma la cookie de sesión. Obligatorio en producción. |

El resto de la configuración ya viene resuelta en `.env.example`.

Mientras falte `METRICOOL_API_TOKEN`, la API se niega a arrancar con un mensaje explícito.
Ese comportamiento es deliberado: es preferible no arrancar a arrancar en un modo distinto
del que el operador cree tener.

## 2. Inicio de sesión con Google

Con `SAC_FLOW_AUTH_MODE=google` cada persona entra con su cuenta de Google:

1. El navegador va a `GET /api/auth/google/start`; la API genera `state`, `nonce` y un
   verificador PKCE, los guarda en una cookie firmada de 10 minutos y redirige a Google.
2. Google vuelve a `GOOGLE_OAUTH_REDIRECT_URI` (`/api/auth/google/callback`). La API canjea
   el código con el client secret, verifica el `id_token` (firma, audiencia, emisor,
   vigencia, `nonce`) y exige un correo verificado.
3. Se consulta la allowlist local. Sin autorización no hay acceso.
4. Se emite la cookie httpOnly `wiwo_nodes_session`, firmada con
   `SAC_FLOW_AUTH_SESSION_SECRET`, y el navegador vuelve a la app.
5. Cada solicitud posterior revalida la cookie **y relee la allowlist**, de modo que quitar
   a alguien corta su acceso sin esperar a que expire la cookie.

### Configurar el cliente OAuth en Google Cloud

En el cliente OAuth (Aplicación web) registre, para cada entorno:

| Entorno | Orígenes de JavaScript autorizados | URI de redireccionamiento autorizados |
| --- | --- | --- |
| Desarrollo (`npm run dev:all`) | `http://localhost:5173` | `http://localhost:5173/api/auth/google/callback` |
| Contenedor local (`SERVE_FRONTEND=true`, puerto 8787) | `http://localhost:8787` | `http://localhost:8787/api/auth/google/callback` |
| Producción | `https://<dominio-de-nodes>` | `https://<dominio-de-nodes>/api/auth/google/callback` |

La URI debe coincidir exactamente con `GOOGLE_OAUTH_REDIRECT_URI` (en desarrollo, si no se
define, se usa la de la primera fila). Si la app se monta bajo una ruta, inclúyala en ambas.

### Allowlist y roles

El acceso se autoriza solo desde el backend; los correos nunca se versionan. Hay tres
fuentes, consultadas en este orden:

1. Archivo JSON `SAC_FLOW_AUTH_ALLOWED_USERS_FILE` (por defecto `data/allowed-users.json`,
   fuera de git) con la forma de `allowed-users.example.json`. Permite afinar rol y marcas por
   persona. En el contenedor de producción `data/` no está montado: úselo solo si agrega el
   volumen.
2. Variables del servidor, recomendadas en contenedores: `SAC_FLOW_AUTH_ADMIN_EMAILS` (rol
   admin) y `SAC_FLOW_AUTH_ALLOWED_EMAILS` (rol `SAC_FLOW_AUTH_DEFAULT_ROLE`), separadas por
   comas. `docker-compose.production.yml` ya las pasa al contenedor junto con el resto de
   variables de inicio de sesión.
3. Opcional, `SAC_FLOW_AUTH_ALLOWED_DOMAINS`: todo correo verificado de esos dominios entra
   con el rol por defecto. Déjelo vacío para autorizar solo correos explícitos.

Cambiar estas variables requiere reiniciar la API.

| En la allowlist (`permissions`) | Rol en Nodes | Alcance |
| --- | --- | --- |
| `admin` | `admin` | Portafolio completo, siempre |
| `sac` | `agent` (configurable) | Todas las marcas, salvo override |
| Cualquier otro | Sin acceso | `403 PERMISSION_REQUIRED` |

Dos campos opcionales permiten afinar:

- `nodesRole`: `viewer`, `agent`, `supervisor` o `admin`.
- `nodesBrandIds`: lista de `brandId` visibles, o `"*"` para todo. No recorta a un admin.

### Sesión y gateway

Con inicio de sesión activo, los headers `X-SAC-*` dejan de tener efecto y la clave
compartida `SAC_FLOW_API_KEY` no se pide al navegador: el actor proviene exclusivamente de
la cookie firmada.

Para volver al comportamiento anterior, `SAC_FLOW_AUTH_MODE=local`.

## 3. Alta de las marcas reales

No transcriba `blogId` a mano. El catálogo se descubre desde Metricool:

```powershell
# Lista las marcas visibles para el token, indicando cuáles ya están vinculadas.
Invoke-RestMethod http://localhost:8787/api/metricool/brands
```

Cada entrada trae `blogId`, etiqueta, redes conectadas y `linkedTo` cuando ya existe una
marca local asociada. Para dar de alta:

```powershell
$body = @{ blogIds = @("457689", "877033"); instagramProvider = "INSTAGRAM" } | ConvertTo-Json
Invoke-RestMethod http://localhost:8787/api/metricool/brands/import -Method Post `
  -ContentType 'application/json' -Body $body
```

La importación es idempotente por `blogId`: repetirla no duplica marcas. Devuelve las
creadas y las omitidas con su motivo (`ALREADY_LINKED`, `NO_SUPPORTED_CHANNELS`).

Ambas rutas exigen rol `admin` con alcance completo de marcas, y ninguna escribe en
Metricool.

Después de importar, retire las 20 marcas ficticias del seed para que la sincronización no
registre errores por cuentas sin referencia.

### El proveedor de Instagram importa

El inbox de Metricool responde `200` con lista vacía cuando el proveedor no corresponde,
no un error. Es decir, una configuración equivocada se ve exactamente igual que una marca
sin mensajes.

Verifique cuál corresponde antes de dar por buena una bandeja vacía:

- `INSTAGRAM`: la cuenta se conectó con credenciales de Instagram.
- `INSTAGRAMBUSINESS`: la cuenta se conectó a través de Facebook.

La sincronización intenta el proveedor alternativo cuando el primario no devuelve nada, de
modo que una configuración equivocada degrada el rendimiento pero no pierde datos.

## 4. Persistencia

El modo live con repositorio JSON solo se permite fuera de producción. El destino es
PostgreSQL, que además es requisito para cifrar las referencias por cuenta:

```powershell
.\scripts\bootstrap-production.ps1 -OutputPath .env.production -SiteApiKey '<clave>'
docker compose --env-file .env.production -f docker-compose.production.yml up --build -d
Invoke-RestMethod http://localhost:8787/api/ready
```

## 5. Orden de activación

Cada interruptor es una decisión separada. No los levante juntos.

1. **Lectura.** `SAC_FLOW_INBOX_SYNC_ENABLED=true`. Entran conversaciones y comentarios
   reales. Nada sale hacia Metricool.
2. **Respuesta manual.** `SAC_FLOW_ENABLE_MANUAL_REPLIES=true` y
   `SAC_FLOW_DISABLE_OUTBOUND_SENDS=false`, solo tras una UAT firmada.
3. **Auto-respuesta.** `SAC_FLOW_AUTO_REPLY_DISPATCH_MODE` permanece en `shadow` hasta que
   el modo sombra demuestre precisión suficiente sobre casos reales.

`SAC_FLOW_DISABLE_EXTERNAL_NODES` y `SAC_FLOW_DISABLE_METRICOOL_MUTATIONS` se mantienen en
`true` durante todo el piloto.

## 6. Verificación

```powershell
Invoke-RestMethod http://localhost:8787/api/health   # identity=google, mode=live
Invoke-RestMethod http://localhost:8787/api/ready    # repositorio y Metricool
Invoke-RestMethod http://localhost:8787/api/metricool/brands
Invoke-RestMethod http://localhost:8787/api/sync -Method Post -ContentType 'application/json' -Body '{"limit":25}'
```

Resultados esperados: `identity` en `google`, marcas reales listadas con sus redes, y una
sincronización que reporta interacciones creadas sin duplicados. `outboundSends` debe seguir
en `disabled`.
