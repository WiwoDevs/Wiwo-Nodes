# Puesta en marcha con datos reales

Guía para pasar de la demo local a operar el portafolio real de marcas en Metricool, con
inicio de sesión corporativo. Complementa `LOCAL_DEVELOPMENT.md`, que cubre el modo demo.

El orden importa: identidad primero, luego lectura real, y solo al final envíos.

## 1. Secretos que debe colocar el equipo

Estos tres valores no se versionan y no deben pegarse en ningún documento. Van únicamente
en `.env` local o en el gestor de secretos del entorno.

| Variable | Origen | Notas |
| --- | --- | --- |
| `METRICOOL_API_TOKEN` | Cuenta Metricool autorizada | Es el mismo token que usa METRIQ en `METRICOOL_USER_TOKEN`. Viaja en el header `X-Mc-Auth`. |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Consola de Firebase del proyecto compartido | JSON de la cuenta de servicio, crudo o en base64. Es el mismo valor que METRIQ. |
| `VITE_FIREBASE_*` | Consola de Firebase, sección Web App | No son secretos: viajan en el bundle del navegador. Equivalen a los `NEXT_PUBLIC_FIREBASE_*` de METRIQ. |

El resto de la configuración ya viene resuelta en `.env.example`.

Mientras falte `METRICOOL_API_TOKEN`, la API se niega a arrancar con un mensaje explícito.
Ese comportamiento es deliberado: es preferible no arrancar a arrancar en un modo distinto
del que el operador cree tener.

## 2. Identidad compartida con METRIQ

Wiwo Nodes no tiene usuarios propios. Reutiliza el proyecto Firebase y la allowlist de
METRIQ, de modo que dar y quitar acceso se hace en un solo lugar.

El flujo es idéntico al de METRIQ:

1. El navegador abre el popup de Google y obtiene un `idToken`.
2. `POST /api/auth/session` verifica ese token con el Admin SDK.
3. Se consulta `allowed_users/{email}` en Firestore. Sin documento no hay acceso: no existe
   fallback por dominio de correo.
4. Se emite una cookie httpOnly firmada por Firebase, con nombre propio
   (`wiwo_nodes_session`) para no colisionar con la sesión de METRIQ.
5. Cada solicitud posterior revalida la cookie **y relee la allowlist**, de modo que quitar
   un permiso en Firestore corta el acceso sin esperar a que expire la cookie.

### Permisos y roles

| En Firestore (`permissions`) | Rol en Nodes | Alcance |
| --- | --- | --- |
| `admin` | `admin` | Portafolio completo, siempre |
| `sac` | `agent` (configurable) | Todas las marcas, salvo override |
| Cualquier otro | Sin acceso | `403 PERMISSION_REQUIRED` |

El permiso exigido se controla con `SAC_FLOW_AUTH_REQUIRED_PERMISSION`, que por defecto es
`sac`. **Conviene decidir esto explícitamente**: con el valor por defecto, cualquier persona
que hoy tenga acceso a la reportería SAC de METRIQ entra también a Nodes. Si se quiere una
puerta separada, use un permiso propio (por ejemplo `nodes`) y agréguelo a las cuentas que
correspondan.

Dos campos opcionales del documento permiten afinar sin tocar los permisos del resto del
portal:

- `nodesRole`: `viewer`, `agent`, `supervisor` o `admin`.
- `nodesBrandIds`: lista de `brandId` visibles, o `"*"` para todo. No recorta a un admin.

### Sesión y gateway

Cuando la identidad Firebase está activa, los headers `X-SAC-*` dejan de tener efecto: el
actor proviene exclusivamente de la cookie firmada. Esto elimina la dependencia de un
gateway que reescriba cabeceras, que era la brecha `SEC-01`/`SEC-02` del checklist.

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
Invoke-RestMethod http://localhost:8787/api/health   # identity=firebase, mode=live
Invoke-RestMethod http://localhost:8787/api/ready    # repositorio y Metricool
Invoke-RestMethod http://localhost:8787/api/metricool/brands
Invoke-RestMethod http://localhost:8787/api/sync -Method Post -ContentType 'application/json' -Body '{"limit":25}'
```

Resultados esperados: `identity` en `firebase`, marcas reales listadas con sus redes, y una
sincronización que reporta interacciones creadas sin duplicados. `outboundSends` debe seguir
en `disabled`.
