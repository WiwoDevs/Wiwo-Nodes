# WIWO.Nodes

Plataforma de atención al cliente (SAC) multicuenta de WIWO. Reúne en un solo lugar los mensajes directos, comentarios y reseñas de las marcas que se gestionan en **Metricool** (Instagram, Facebook, X, TikTok Business, YouTube, LinkedIn y Google Business). Desde ahí el equipo responde, coordina quién atiende cada caso y saca las métricas del **reporte mensual**. Incluye además un módulo de automatización general (Automation Studio).

- **Producción:** https://nodes.wiwo.me. Cada push a `main` se despliega solo (ver [Despliegue](#despliegue)).
- **Inicio de sesión:** Google, contra una lista de personas autorizadas. No hay usuario y contraseña en producción.
- **Datos:** PostgreSQL en producción y JSON local en desarrollo. Metricool solo se lee, salvo las respuestas que una persona confirma.

---

## Qué hay en la web

| Sección | Para qué sirve | Quién la ve (permisos por defecto) |
| --- | --- | --- |
| **Inicio** | Lo que necesita atención primero. El Agente ve *sus* casos en plazo y **Tomar siguiente**. El Supervisor suma el panel **Equipo** (carga por persona). El Admin suma el panel **Sistema** (sincronización, envío automático y trabajos fallidos). | Todos |
| **Bandeja SAC** | Una fila por persona y cuenta, ordenada por lo que vence antes. Tiene filtros que se recuerdan, buscador de cuentas, **Mis casos**, **Tomar siguiente**, atajos `J`/`K`/`R`/`E`, archivado de casos vencidos y exportación a Excel. | Todos |
| **Gestión DMs** / **Gestión comentarios** | Trabajo por cuenta: cola y conversación lado a lado. Los comentarios se agrupan por publicación. | Todos |
| **Resumen SAC** | Totales y rendimiento por marca. | Supervisor, Admin |
| **Reportes** | Cifras del **informe SAC mensual** por marca: casos, respondidos, cobertura, variación contra el mes anterior, motivos, tono y canales. Muestra avisos de datos antes de presentar y descarga el Excel del mes. | Supervisor, Admin |
| **Flujo SAC** | Reglas del protocolo SAC, versiones y publicación. | Supervisor, Admin |
| **Cuentas** | Estado de marcas y cuentas, y su centro documental. Solo Admin puede crear, editar, desactivar o conectar marcas con Metricool. | Supervisor (lectura), Admin |
| **Automatización**, **Ejecuciones**, **Plantillas** | Editor visual de automatizaciones, historial y plantillas. | Admin |
| **Credenciales**, **Usuarios** | Credenciales cifradas; personas, roles y permisos. | Admin |
| **Configuración** | Ajustes del flujo y diagnóstico de la integración. | Supervisor, Admin |

El menú y los botones se muestran según los **permisos** de cada persona, no según el nombre de su rol. Si un Admin le da a alguien un permiso extra, la sección correspondiente le aparece. El servidor vuelve a validar cada acción.

## Roles y permisos

| Rol | Qué puede hacer |
| --- | --- |
| **Lector** | Ver bandejas y conversaciones de sus marcas. |
| **Agente** | Lo anterior, más responder, tomar y soltar casos, notas internas, cambiar estados y actualizar desde Metricool. |
| **Supervisor** | Lo anterior, más asignar casos a otros, archivar vencidos, exportar, ver métricas y reportes, conciliar envíos y ajustar el flujo SAC. |
| **Admin asignado** | Rol Admin dado desde la app. Administra usuarios, credenciales y envío automático, pero **no** puede dar el rol Admin, cambiar a otro admin, editar roles ni otorgar permisos sensibles. |
| **Admin principal** | Correos en `SAC_FLOW_AUTH_ADMIN_EMAILS`. Puede todo y no se puede cambiar desde la app. |

- Lector, Agente y Supervisor son **editables**, y se pueden crear roles propios a partir de ellos. A una persona en particular se le pueden sumar o quitar permisos.
- **Permisos sensibles** (solo los otorga un admin principal): *Gestionar marcas*, *Editar automatizaciones*, *Publicar el flujo SAC*, *Archivar vencidos en lote* y *Exportar a Excel*.
- Nadie puede cambiar su propio rol.

Detalle completo: [docs/PUESTA_EN_MARCHA_REAL.md](docs/PUESTA_EN_MARCHA_REAL.md).

## Cómo fluye un caso

1. **Lectura:** un worker lee Metricool cada cierto intervalo, solo lectura (`SAC_FLOW_INBOX_SYNC_ENABLED`). La web es **en vivo**: la API avisa cada cambio (respuestas, asignaciones, estados, sincronización) y cada navegador baja solo lo que cambió, así contadores como "Por atender en plazo" se actualizan en un segundo sin recargar. También ofrece **Actualizar ahora**.
2. **Clasificación:** el protocolo `sac-v1` clasifica intención y riesgo y propone una respuesta basada en las preguntas y respuestas aprobadas de la marca. Los casos sensibles o negativos van siempre a revisión humana.
3. **Atención:** una persona toma el caso, revisa la recomendación, redacta y **confirma** el envío. Cada envío queda auditado y se protege contra duplicados.
4. **Plazos de Meta:** 7 días para DMs y 24 horas para comentarios, contados desde el último mensaje del cliente. Fuera de plazo se puede intentar responder igual (Meta decide). Esos casos se ocultan por defecto y un Supervisor puede archivarlos como histórico sin tocar Metricool.

El **envío automático** está apagado por defecto y nunca responde casos vencidos ni sensibles.

## Reporte mensual

La sección **Reportes** calcula, por mes y marca, las mismas cifras del informe SAC:
- Casos SAC frente a mensajes recibidos (volumen gestionado o bruto).
- Respondidos y cobertura.
- Variación contra el mes anterior, que se marca como *no comparable* si ese mes está incompleto.
- Motivos, tono y canales.

Antes de presentar, la sección avisa de datos dudosos: mensajes sin clasificar, cuentas duplicadas (dos marcas apuntando al mismo usuario) o una sincronización detenida. El Excel del mes, de todas las marcas o de una, usa los mismos días (UTC) que las cifras.

**Caso o ruido:** sin IA, las reglas separan el ruido social (reacciones, menciones, emojis sueltos, textos muy cortos). El equipo corrige a mano desde el detalle de cada caso o en lote desde la Bandeja, y lo marcado a mano manda. La sección muestra cuánto del mes se decidió a mano, con IA o por reglas.

Notas para que los números sean confiables:
- La cobertura cuenta solo casos **respondidos**: archivar casos vencidos no la infla.
- Al vincular marcas, una marca de Metricool cuyo Instagram ya está vinculado se omite, para no contar mensajes dos veces.
- Las marcas desactivadas no entran en métricas ni reportes.

## Desarrollo local

Requisitos: Node.js 22 y npm. Docker es opcional.

```bash
cp .env.example .env        # en PowerShell: Copy-Item .env.example .env
npm ci
npm run dev:all
```

Abre http://localhost:5173. Vite reenvía `/api` a Fastify en el puerto 8787.

- **Modo demo** (`METRICOOL_MODE=demo`, por defecto): 20 marcas ficticias, sin credenciales.
- **Probar con roles** sin Google: `SAC_FLOW_AUTH_MODE=dev` usa los usuarios ficticios de `dev-users.example.json`, uno por rol. El servidor se niega a arrancar así en producción. Ver [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md).
- Comprobación rápida: `curl --fail http://localhost:8787/api/health` y `.../api/ready`.

## Despliegue

- **Producción** (`docker-compose.production.yml`): PostgreSQL, migraciones (`migrate`), API y worker. La API sirve la web compilada en el puerto 8787 y responde 404 real para `/api/*` desconocidas.
- **Deploy:** el workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) se ejecuta en cada push a `main` y despliega por SSH. Los cambios en los archivos de Docker Compose requieren aprobación manual en el servidor antes de aplicarse.
- **Variables:** se documentan en [`.env.example`](.env.example). Las principales:
  - `SAC_FLOW_AUTH_MODE=google` con `GOOGLE_OAUTH_CLIENT_ID`/`SECRET`.
  - `SAC_FLOW_AUTH_ADMIN_EMAILS` (admins principales), `SAC_FLOW_AUTH_SUPERVISOR_EMAILS`, `SAC_FLOW_AUTH_ALLOWED_EMAILS` / `_DOMAINS`.
  - `SAC_FLOW_REPOSITORY=postgres`.
  - Los cortacorrientes `SAC_FLOW_DISABLE_OUTBOUND_SENDS` y `SAC_FLOW_DISABLE_METRICOOL_MUTATIONS`.
- **Docker local** (un solo contenedor con JSON): `docker compose up --build -d` y abrir http://localhost:8787.

Puesta en marcha real paso a paso: [docs/PUESTA_EN_MARCHA_REAL.md](docs/PUESTA_EN_MARCHA_REAL.md). Operación e incidentes: [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md).

## Límites de Metricool y Meta

- La API de Metricool requiere plan **Advanced o Custom**.
- Instagram solo expone la bandeja principal: no aparecen solicitudes ni carpetas filtradas.
- Los comentarios de anuncios no se pueden responder desde el Inbox.
- Plazos informados por Metricool: 24 h para comentarios y 7 días para DMs. Fuera de plazo se puede intentar, pero Metricool o Meta pueden rechazar la respuesta.
- El proveedor de Instagram debe coincidir con cómo se conectó la cuenta en Metricool (`INSTAGRAMBUSINESS` o `INSTAGRAM`).

Configuración: [docs/METRICOOL_SETUP.md](docs/METRICOOL_SETUP.md).

## Seguridad

- El token de Metricool y el secreto de Google viven solo en el `.env` del servidor o en el gestor de secretos. Nunca en el navegador, respuestas HTTP, Excel, logs, capturas ni commits.
- Las credenciales del módulo de automatización se guardan cifradas (AES-256-GCM) y nunca vuelven al navegador.
- La web aplica CSP estricta (sin estilos ni scripts en línea) y cookies de sesión `HttpOnly`.
- No se versionan datos reales: correos, teléfonos, DMs, comentarios ni IDs de Metricool. La demo usa solo datos ficticios.

Más detalle: [docs/SECURITY.md](docs/SECURITY.md).

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev:all` | Web (Vite, 5173) + API (Fastify, 8787) |
| `npm run check` | Typecheck de web y API |
| `npm run build:all` | Compila la web y la API (`dist/`, `dist-api/`) |
| `npm test` | Pruebas de API, contrato Sites y migraciones |
| `npm run test:e2e` | Pruebas Playwright de escritorio y móvil |
| `npm run verify` | `check` + `build:all` + `test` + auditoría de dependencias |
| `npm run migrate` | Aplica migraciones de PostgreSQL |
| `npm run start:worker` | Worker de sincronización y envíos (requiere PostgreSQL) |
| `npm start` | API compilada (requiere `build:all`) |

La lista completa está en `scripts` de [`package.json`](package.json). En `scripts/` hay además herramientas de línea de comandos para importaciones, clasificación y planillas.

Antes de entregar un cambio: `npm run check`, `npm run build:all`, `npm test` y, si aplica, la prueba de salud con Docker.

## Documentación

| Documento | Contenido |
| --- | --- |
| [PUESTA_EN_MARCHA_REAL.md](docs/PUESTA_EN_MARCHA_REAL.md) | Inicio de sesión, roles, menú por permiso, Reportes, paso a live |
| [OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md) | Operación diaria, plazos, incidentes y rollback |
| [API_CONTRACT.md](docs/API_CONTRACT.md) | Contrato HTTP de la API |
| [LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) | Desarrollo local y usuarios de prueba |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura de web, API, worker y repositorios |
| [METRICOOL_SETUP.md](docs/METRICOOL_SETUP.md) | Configuración de Metricool |
| [POSTGRESQL_MIGRATION.md](docs/POSTGRESQL_MIGRATION.md) | Paso de JSON a PostgreSQL |
| [SECURITY.md](docs/SECURITY.md) | Seguridad y privacidad |
| [HANDOFF_TECHLAB.md](docs/HANDOFF_TECHLAB.md) | Traspaso a Techlab |
| [N8N_PARITY_AUDIT.md](docs/N8N_PARITY_AUDIT.md) | Comparación del módulo de automatización con n8n (implementación original) |

## Estructura

```text
src/                         web React/Vite
server/                      API Fastify, worker, dominio SAC, Metricool y repositorios
db/migrations/               esquema PostgreSQL (con RLS)
tests/                       pruebas de API, migraciones y empaquetado
scripts/                     migraciones, importaciones y herramientas de línea de comandos
docs/                        contratos, operación y puesta en marcha
.github/workflows/deploy.yml despliegue a producción en cada push a main
Dockerfile                   imagen única web + API
docker-compose.yml           ejecución local persistente (JSON)
docker-compose.production.yml PostgreSQL + migraciones + API + worker
```
