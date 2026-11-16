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
   admin), `SAC_FLOW_AUTH_SUPERVISOR_EMAILS` (rol supervisor) y `SAC_FLOW_AUTH_ALLOWED_EMAILS`
   (rol `SAC_FLOW_AUTH_DEFAULT_ROLE`), separadas por comas. Si un correo aparece en varias, gana
   la de mayor rol; un correo de un dominio permitido que esté en una lista recibe el rol de esa lista. `docker-compose.production.yml` ya las pasa al contenedor junto con el resto de
   variables de inicio de sesión.
3. Opcional, `SAC_FLOW_AUTH_ALLOWED_DOMAINS`: todo correo verificado de esos dominios entra
   con el rol por defecto. Déjelo vacío para autorizar solo correos explícitos.

Cambiar estas variables requiere reiniciar la API.

Además, un admin puede asignar o quitar roles desde **Usuarios y roles** (menú Sistema) sin
tocar el servidor: el rol asignado manda sobre las listas de supervisores y permitidos y sobre
los dominios, rige en la siguiente acción de la persona y queda en la tabla `user_access`.
En la pestaña **Roles** puede ajustar los permisos de Lector, Agente y Supervisor (por ejemplo,
quitar Exportar al Supervisor) o crear roles propios como "Supervisor sin exportar"; se guardan
en `access_roles`. Al hacer clic en una persona puede ajustar lo que puede hacer solo ella (por
ejemplo, un Supervisor en específico sin Exportar); esos ajustes se guardan como diferencia con
su rol. Admin no se edita y la administración (usuarios y roles, credenciales, envío
automático, auditoría) no se puede delegar.

El menú lateral muestra a cada persona solo lo que sus permisos le dejan usar (basta uno):
Inicio, Bandeja SAC y Gestión DMs/comentarios para todos; **Resumen SAC** con *Ver métricas y
cola*; **Flujo SAC** y **Configuración** con *Ajustar el flujo SAC* (o *Publicar* para el flujo);
**Cuentas** con *Gestionar marcas* o *Ver métricas y cola*; **Automatización**, **Ejecuciones** y
**Plantillas** con *Editar automatizaciones*; **Credenciales** y **Usuarios** solo Admin. Con los
permisos por defecto, el Agente ve las 4 primeras, el Supervisor suma Resumen, Flujo, Cuentas y
Configuración, y Admin lo ve todo. Ocultar ordena la pantalla; el servidor valida cada acción.

Inicio también cambia según el rol. El **Agente** ve "Mis casos en plazo", lo que vence en 24 h
y el botón **Tomar siguiente**, con sus casos primero en la cola. El **Supervisor** (quien tiene
*Ver métricas y cola* o *Asignar a otras personas*) ve además el panel **Equipo**: casos en plazo
de cada persona y los que nadie tomó. **Admin** suma el panel **Sistema**: última sincronización
con Metricool, sincronización automática, envío automático y trabajos fallidos. Los botones que
un rol no puede usar no se muestran (Exportar vista, Tomar siguiente, Actualizar cuenta, Importar
o Conectar Metricool, Nueva marca), y la versión interna del caso solo la ve supervisión.
`SAC_FLOW_AUTH_ADMIN_EMAILS` sigue siendo la llave maestra: esos correos son siempre admin y no
se pueden cambiar desde la app, así nunca se pierde el acceso de administración.

Hay dos clases de Admin. El **admin principal** está en `SAC_FLOW_AUTH_ADMIN_EMAILS` y puede
todo. El **admin asignado** recibió el rol Admin desde la app: administra igual (usuarios,
credenciales, envío automático), pero no puede dar el rol Admin ni cambiar a otro admin, solo
mira la pestaña **Roles** (no crea, edita ni restablece roles) y no puede dar a nadie los
permisos sensibles: *Gestionar marcas*, *Editar automatizaciones*, *Publicar el flujo SAC*,
*Archivar vencidos en lote* y *Exportar a Excel*. Eso incluye asignar un rol que los traiga a
quien no los tenía (por ejemplo, pasar un Agente a Supervisor). Sí puede quitarlos o bajar de
rol a alguien.

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

### Worker y despachador en modo Google

El worker de sincronización y el despachador de respuestas automáticas no tienen navegador ni cookie. Con inicio de sesión activo, `SAC_FLOW_API_KEY` deja de ser una credencial de navegador y pasa a ser solo interna: con `X-API-Key` o `Authorization: Bearer` abre únicamente `POST /api/sync` (worker) y `POST /api/interactions/:id/reply` (despachador de respuestas automáticas), con un actor de servicio `service:worker`, rol `agent` y todas las marcas. Una clave incorrecta en esas rutas responde `401 UNAUTHORIZED`; en cualquier otra ruta o método la clave no tiene efecto y se exige la cookie de una persona (`401 SESSION_REQUIRED`). Cada uso queda registrado como evento `service_actor`, sin la clave.

Por eso `SAC_FLOW_API_KEY` debe seguir definido en el servidor (el compose de producción ya lo exige) y nunca se entrega al navegador. Si falta con el inicio de sesión activo y la sincronización encendida, la API lo advierte al arrancar.

Las rutas de solo lectura `/api/integrations/*` que consume METRIQ usan otra clave, `SAC_FLOW_SERVICE_API_KEY` (32+ caracteres), que el compose de producción ahora pasa al contenedor.

## 3. Alta de las marcas reales

No hace falta importar nada a mano. En live, **cada sincronización** (cada 5 minutos o con
**Actualizar ahora**) lee el catálogo de marcas que ve el token y:

- vincula sola cada marca nueva que tenga al menos una red que la bandeja sabe leer, con su
  `blogId` y el proveedor de Instagram de `METRICOOL_INSTAGRAM_PROVIDER`;
- desactiva las 20 marcas de ejemplo del seed que nunca tuvieron referencia, sin borrar su
  historial. Esto también ocurre **al arrancar la API en live**, aunque el catálogo no
  responda, así nunca se ven como cuentas sin conectar. Las marcas desactivadas no cuentan como
  alertas en Inicio ni en Cuentas; en Cuentas quedan bajo el filtro **Desactivadas**;
- no duplica (va por `blogId`) y nunca escribe en Metricool. Si el catálogo no responde, la
  sincronización sigue con las marcas ya vinculadas.

Para que una marca del catálogo **no** se atienda en SAC: desactívela en **Cuentas** (conserva
su vínculo, deja de sincronizar y no vuelve a crearse) o agregue su `blogId` a
`SAC_FLOW_METRICOOL_EXCLUDED_BLOG_IDS`. `SAC_FLOW_METRICOOL_AUTO_LINK=false` apaga todo el
mecanismo. Leer el catálogo **requiere `METRICOOL_USER_ID`** (el dueño del portafolio en Metricool). Si
falta, la API lo advierte al arrancar y cada sincronización lo registra como paso fallido
"Catálogo Metricool". `docker-compose.production.yml` pasa al contenedor `METRICOOL_USER_ID`,
`METRICOOL_INSTAGRAM_PROVIDER`, `SAC_FLOW_METRICOOL_AUTO_LINK` y
`SAC_FLOW_METRICOOL_EXCLUDED_BLOG_IDS`.

La sincronización programada del worker cubre todo el portafolio activo sin enviar una
lista de cuentas, así que no la limita el máximo de 20 cuentas por pedido manual.

El catálogo también se puede revisar a mano:

**Desde la web (recomendado, y la única vía con inicio de sesión de Google):** en **Cuentas → Importar desde Metricool** un administrador ve las marcas que el token del servidor puede leer, con sus redes y si ya están vinculadas. Marque las que se atienden en SAC (no hay preselección: el catálogo puede incluir marcas de otros equipos), elija cómo está conectado Instagram y pulse **Importar**. En el mismo panel, **Marcas sin conexión a Metricool** permite desactivar de una vez las marcas que nunca sincronizan, como las 20 de ejemplo; desactivar no borra historial.

**Por API (solo con `SAC_FLOW_AUTH_MODE=local`, porque con Google las rutas exigen la cookie de una persona):**

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
creadas y las omitidas con su motivo (`ALREADY_LINKED`, `NO_SUPPORTED_CHANNELS`,
`DUPLICATE_INSTAGRAM`). Una marca de Metricool cuyo Instagram ya está vinculado a otra marca
no se vincula (traería los mismos mensajes dos veces); la vinculación automática lo informa
en la auditoría del ciclo. Si ya existe un duplicado, desactiva una de las dos cuentas en
**Cuentas**: sus conversaciones dejan de contarse y de sincronizarse.

Ambas rutas exigen rol `admin` con alcance completo de marcas, y ninguna escribe en
Metricool.

Después de importar, retire las 20 marcas ficticias del seed (desde el mismo panel) para que la
sincronización no registre errores por cuentas sin referencia.

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
