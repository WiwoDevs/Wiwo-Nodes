# Desarrollo local

## Requisitos

- Node.js 22 LTS y npm.
- PowerShell 7+ en Windows o una shell POSIX en macOS/Linux.
- Docker Desktop/Engine con Compose v2 solo para la ruta de contenedor.
- Cuenta Metricool Advanced/Custom únicamente si se probará el modo live.

Confirmar herramientas:

```powershell
node --version
npm --version
docker --version
docker compose version
```

Docker es opcional para `npm run dev:all`.

En esta estación Docker Desktop 4.86.0 está instalado y WSL/Virtual Machine Platform están habilitados. El stack profesional ya completó un smoke local con PostgreSQL, once migraciones, API y worker saludables.

## Primera ejecución en modo demo

Desde la raíz del repositorio:

```powershell
Copy-Item .env.example .env
npm ci
npm run dev:all
```

En bash:

```bash
cp .env.example .env
npm ci
npm run dev:all
```

Servicios:

| Servicio | URL | Notas |
| --- | --- | --- |
| Web Vite | `http://localhost:5173` | Hot reload; usa proxy `/api` |
| Fastify | `http://localhost:8787` | API bajo `/api` |
| Salud | `http://localhost:8787/api/health` | No contiene secretos |
| Readiness | `http://localhost:8787/api/ready` | Confirma que el repositorio responde |
| Métricas | `http://localhost:8787/api/metrics` | Requiere rol `supervisor`; agregados sin PII |

La ausencia de credenciales es intencional. Mantener en `.env`:

```dotenv
METRICOOL_MODE=demo
METRICOOL_API_TOKEN=
SAC_FLOW_DISABLE_EXTERNAL_NODES=true
SAC_FLOW_DISABLE_METRICOOL_MUTATIONS=true
SAC_FLOW_DISABLE_OUTBOUND_SENDS=true
SAC_FLOW_ENABLE_MANUAL_REPLIES=false
SAC_FLOW_INBOX_SYNC_ENABLED=false
SAC_FLOW_AUTO_REPLY_DISPATCH_MODE=shadow
SAC_FLOW_AUTO_REPLY_MAX_PENDING=1000
```

El seed crea 20 marcas ficticias, tres workflows generales, una credencial placeholder sin secretos y variables locales en `data/sac-flow.json`. `.gitignore` excluye ese archivo.

Smoke de Automation Studio:

```powershell
Invoke-RestMethod http://localhost:8787/api/platform
Invoke-RestMethod http://localhost:8787/api/platform/catalog
Invoke-RestMethod http://localhost:8787/api/platform/templates
Invoke-RestMethod http://localhost:8787/api/platform/workflows/automation-daily-report/run -Method Post -ContentType 'application/json' -Body '{"input":[{"id":"a","status":"open"}]}'
```

No use el smoke local para habilitar nodos HTTP, escribir en Metricool ni enviar respuestas. Esas acciones requieren autorización explícita y un entorno UAT controlado.

## Stack productivo autocontenido

```powershell
.\scripts\bootstrap-production.ps1 -OutputPath .env.production -SiteApiKey '<clave-del-sitio>'
docker compose --env-file .env.production -f docker-compose.production.yml up --build -d
Invoke-RestMethod http://localhost:8787/api/ready
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

Compose de producción publica la API en `127.0.0.1` por defecto mediante `SAC_FLOW_BIND_ADDRESS`. No usar `0.0.0.0` sin un gateway autorizado, firewall y autenticación verificada.

Después de construir el contenedor puede comprobar el outbox contra PostgreSQL real, sin contactar a Metricool:

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml exec api npm run smoke:postgres-outbox
```

El smoke crea una organización efímera, prueba preparación y lease concurrentes, reserva atómica del último cupo de la cola, exclusión de envíos simultáneos por cuenta, bloqueo antes de `Retry-After`, reanudación después del cooldown, breaker `uncertain`, desbloqueo tras conciliación y elimina únicamente ese fixture al terminar.

El script genera contraseña PostgreSQL y claves separadas para referencias y credenciales generales. El compose aplica migraciones, arranca API y worker, conserva los tres bloqueos externos y fija el despacho automático en `shadow`. `postgres`, `api` y `worker` deben quedar `healthy`; el worker sirve su probe interno en el puerto `8788` sin publicarlo al host. Cuando se entregue Metricool se actualizan `METRICOOL_API_TOKEN`, `METRICOOL_ACCOUNTS_JSON`, `METRICOOL_MODE=live` y el seed demo se desactiva. Pasar `SAC_FLOW_AUTO_REPLY_DISPATCH_MODE=live` y levantar los cortacorrientes sigue siendo una decisión separada de UAT.

## Desarrollo separado

Para depurar cada proceso en una terminal diferente:

Terminal 1:

```powershell
npm run dev:api
```

Terminal 2:

```powershell
npm run dev
```

Vite reenvía las solicitudes `/api` a `http://localhost:8787`, así que el frontend no necesita CORS ni una URL absoluta en desarrollo.

## Smoke tests

Con ambos procesos activos:

```powershell
Invoke-RestMethod http://localhost:8787/api/health
Invoke-RestMethod http://localhost:8787/api/ready
$brands = Invoke-RestMethod http://localhost:8787/api/brands
$brands.data.Count
Invoke-RestMethod 'http://localhost:8787/api/interactions?page=1&pageSize=5'
Invoke-WebRequest http://localhost:8787/api/export/xlsx -OutFile .\workbook-smoke.xlsx
```

Resultados esperados:

- salud y readiness HTTP 200 en modo `demo`;
- 20 marcas en un estado nuevo;
- interacciones paginadas sin credenciales;
- `workbook-smoke.xlsx` abre como XLSX y no contiene secretos.

Eliminar el archivo de smoke cuando termine la inspección; está fuera del estado persistente y no debe versionarse.

Pruebas de navegador reproducibles:

```powershell
npx playwright install chromium
npm run build:all
npm run test:e2e
```

Cubren desktop/mobile, los 18 nodos, ejecución, historial, reintento y evaluación del workflow. La vista `Ejecuciones` también consulta `/api/jobs?status=dead` y `/api/jobs?status=retry`: el rol `supervisor` puede inspeccionar la cola operativa y `admin` puede reencolar con confirmación. Ninguna de estas acciones escribe en Metricool; el job reencolado conserva las compuertas y cortacorrientes del entorno.

## Probar contexto de actor y permisos

El modo local usa rol `admin` por defecto cuando no se confían cabeceras. Para simular staging detrás de un gateway, arrancar la API con:

```powershell
$env:SAC_FLOW_TRUST_ACTOR_HEADERS='true'
$env:SAC_FLOW_REQUIRE_ACTOR_CONTEXT='true'
$env:SAC_FLOW_DEFAULT_ROLE='viewer'
npm run dev:api
```

En otra terminal:

```powershell
$headers = @{
  'X-SAC-User-Id' = 'tester-01'
  'X-SAC-User-Name' = 'Tester SAC'
  'X-SAC-Tenant-Id' = 'tenant-local'
  'X-SAC-Role' = 'viewer'
  'X-SAC-Brand-Ids' = 'brand-01'
}

Invoke-WebRequest http://localhost:8787/api/brands
Invoke-RestMethod http://localhost:8787/api/brands -Headers $headers
Invoke-RestMethod http://localhost:8787/api/stats/summary -Headers $headers
Invoke-WebRequest http://localhost:8787/api/export/xlsx -Headers $headers
Invoke-RestMethod http://localhost:8787/api/ready
```

Resultados esperados:

- sin cabeceras, las rutas `/api/*` protegidas responden `401 ACTOR_CONTEXT_REQUIRED`;
- con rol `viewer` y `brand-01`, `/api/brands` devuelve solo una marca y las métricas quedan filtradas;
- exportar XLSX responde `403 FORBIDDEN` hasta usar rol `supervisor` o `admin`.
- `/api/ready` responde 200 aunque el contexto de actor sea requerido, porque es un probe de infraestructura.

Este puente no autentica por sí mismo. En staging/producción solo debe usarse detrás de un gateway que elimine cabeceras `X-SAC-*` enviadas por el navegador y las reconstruya desde la sesión SSO validada.

## Probar coordinación multiagente

Con la API iniciada y las cabeceras de agente del apartado anterior:

```powershell
$case = (Invoke-RestMethod 'http://localhost:8787/api/interactions?brandId=brand-01&pageSize=1' -Headers $headers).data[0]
$claim = Invoke-RestMethod "http://localhost:8787/api/interactions/$($case.id)/assignment" -Method Put -Headers $headers -ContentType 'application/json' -Body (@{
  action = 'claim'
  expectedVersion = $case.version
} | ConvertTo-Json)
$note = Invoke-RestMethod "http://localhost:8787/api/interactions/$($case.id)/notes" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{
  text = 'Nota interna de prueba; no se envía a Metricool.'
  expectedVersion = $claim.data.version
} | ConvertTo-Json)
```

Repetir una escritura con la versión inicial debe devolver `409 INTERACTION_VERSION_CONFLICT`. La nota debe aparecer en el detalle del caso, no en Metricool ni como texto completo dentro del evento de auditoría.

## Probar cortacorriente de envíos

Para validar un corte draft-only:

```powershell
$env:SAC_FLOW_DISABLE_OUTBOUND_SENDS='true'
npm run dev:api
```

Resultados esperados:

- `POST /api/interactions/:id/reply` con `mode: "send"` responde `423 OUTBOUND_SENDS_DISABLED`;
- `mode: "draft"` sigue guardando borradores;
- `/api/health` muestra `operations.outboundSendsDisabled=true`;
- la simulación del workflow cuenta las respuestas allowlisted como borradores y deja una advertencia en el audit trail.

En staging/live, mantener esta variable activa durante UAT, incidentes, rollback o ventanas de corte hasta que exista aprobación explícita por marca para enviar.

## Pruebas y build

```powershell
npm run check
npm run build:all
npm run test:migrations
npm test
```

El orden importa en un checkout limpio porque `npm test` incluye el contrato Sites, que inspecciona los artefactos de build, y la validación estática de migraciones PostgreSQL. El contrato heredado exige:

- `dist/client/index.html`;
- `dist/server/index.js`;
- `dist/.openai/hosting.json`.

`npm run test:migrations` puede ejecutarse solo cuando se cambie `db/migrations/`; valida orden, transacciones, tablas requeridas, RLS por tenant y ausencia de fixtures con pinta de secreto.

## Auditar o importar JSON a PostgreSQL

Después de generar `data/sac-flow.json`, se puede revisar el archivo sin tocar PostgreSQL:

```powershell
npm run postgres:audit-json -- .\data\sac-flow.json
```

El reporte incluye hash, recuentos, duplicados, interacciones huérfanas, problemas de workflow y riesgos de fórmula de Excel. Cuenta referencias Metricool configuradas, pero no imprime `userId`, `blogId` ni token.

Para importar en una base staging con migraciones aplicadas:

```powershell
$env:SAC_FLOW_POSTGRES_URL='postgres://...'
$env:SAC_FLOW_POSTGRES_ENCRYPTION_KEY='...'
$env:SAC_FLOW_POSTGRES_ORGANIZATION_SLUG='techlab-sac-staging'
$env:SAC_FLOW_POSTGRES_ORGANIZATION_NAME='Techlab SAC Staging'
npm run postgres:import-json -- .\data\sac-flow.json
```

La importación es transaccional y reemplaza el estado del tenant configurado. Si la auditoría encuentra errores, se bloquea. Si solo hay advertencias, revisar el reporte y usar `npm run postgres:import-json:allow-warnings -- .\data\sac-flow.json` únicamente cuando el equipo acepte el riesgo.

## Ejecutar el build integrado

Tras compilar:

```powershell
$env:NODE_ENV='production'
$env:API_HOST='127.0.0.1'
$env:PORT='8787'
$env:SERVE_FRONTEND='true'
$env:SAC_FLOW_REQUIRE_API_KEY='false'
npm start
```

Abrir `http://localhost:8787` y comprobar tanto una ruta web como `/api/health`. Para validar dependencia de persistencia, comprobar también `/api/ready`. En otra sesión de shell, las variables no quedan persistidas.

## Docker Compose

```powershell
Copy-Item .env.example .env
docker compose config
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://localhost:8787/api/health
Invoke-RestMethod http://localhost:8787/api/ready
docker compose logs --tail 100 sac-flow
```

Abrir `http://localhost:8787`. Para detener:

```powershell
docker compose down
```

El volumen `sac-flow-data` mantiene el JSON entre reinicios. No agregar `-v` a `down` salvo que se haya confirmado el borrado del entorno local.

## Estado local y reinicio de demo

El archivo se define por `SAC_FLOW_DATA_FILE` y por defecto es `./data/sac-flow.json`. Para reiniciar el seed de forma recuperable:

1. detener Vite/API o el contenedor;
2. copiar el JSON actual a una ruta de respaldo fuera de `data/`;
3. mover el archivo original, no sobrescribirlo;
4. iniciar la API para que regenere el seed;
5. eliminar el respaldo solo después de validar.

En Docker, crear primero un backup desde el volumen. No usar `docker compose down -v` como mecanismo habitual de reset porque elimina el volumen completo.

## Activar Metricool live

Seguir [METRICOOL_SETUP.md](./METRICOOL_SETUP.md). Resumen:

1. ejecutar `npm run smoke:metricool-contract` sin secretos ni red externa;
2. confirmar plan Advanced/Custom;
3. obtener token y `userId` por un canal autorizado;
4. asignar `blogId` real a una marca piloto;
5. guardar el token únicamente en `.env` local;
6. cambiar `METRICOOL_MODE=live`;
7. mantener el workflow en borrador;
8. reiniciar API y probar lectura de una marca antes de las 20.

Nunca reutilizar valores del seed como si fueran identificadores reales.

En `NODE_ENV=production` con `METRICOOL_MODE=live`, el runtime no permite `SAC_FLOW_REPOSITORY=json` salvo `SAC_FLOW_ALLOW_JSON_IN_LIVE=true`. Usar esa excepción solo para un puente controlado y documentado; el destino productivo es `SAC_FLOW_REPOSITORY=postgres` con migraciones aplicadas, `SAC_FLOW_POSTGRES_URL`, `SAC_FLOW_POSTGRES_ENCRYPTION_KEY` y pruebas de contrato contra PostgreSQL real.

## Diagnóstico

### El frontend abre pero `/api` falla

- Confirmar que `npm run dev:api` está activo en 8787.
- Revisar el proxy de `vite.config.mjs`.
- Mantener `VITE_API_BASE_URL=/api`; una URL absoluta innecesaria puede introducir CORS.

### El puerto está ocupado

En Windows:

```powershell
Get-NetTCPConnection -LocalPort 5173,8787 -ErrorAction SilentlyContinue
```

Detener el proceso conocido o asignar otro `PORT` a la API y actualizar el target del proxy. No finalizar procesos que no pertenezcan al proyecto sin identificarlos.

### El JSON no se puede escribir

- Confirmar que el directorio padre existe y el usuario tiene permiso.
- Verificar que no haya dos APIs escribiendo el mismo archivo.
- En Docker, verificar el volumen y que el proceso no root tenga acceso a `/app/data`.
- Restaurar desde respaldo si quedó un archivo inválido; no editar mientras la API está activa.

### Metricool devuelve `401` o `403`

- No imprimir el token.
- Confirmar modo live, plan, token, `userId`, `blogId` y permisos.
- Probar una marca en Metricool y rotar el token si se sospecha exposición.

### Hay duplicados

- Repetir con el mismo `externalId` en demo/prueba.
- Confirmar la restricción de deduplicación en el repositorio.
- No borrar el archivo como primer diagnóstico; conservar evidencia de la ejecución.

## Antes de abrir un PR o entregar un ZIP

- [ ] `.env` y `data/*.json` no están incluidos.
- [ ] No hay tokens/PII en logs, fixtures, capturas ni XLSX.
- [ ] `npm ci`, `npm run check`, `npm run build:all`, `npm run test:migrations` y `npm test` pasan, en ese orden.
- [ ] Docker compila y `/api/health` + `/api/ready` responden.
- [ ] La UI muestra que está en demo cuando corresponda.
- [ ] Cambios de rutas/env/modelos están reflejados en README y `docs/`.
- [ ] Se preservan las limitaciones de Metricool/Meta.
