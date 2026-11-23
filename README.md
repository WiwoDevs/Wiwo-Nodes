# wiwo.sac

Plataforma de atención al cliente (SAC) multicuenta de WIWO. Reúne en un solo lugar los mensajes directos, comentarios y reseñas de las marcas que se gestionan en **Metricool** (Instagram, Facebook, X, TikTok Business, YouTube, LinkedIn y Google Business). Desde ahí el equipo responde, coordina quién atiende cada caso y saca las métricas del **reporte mensual**. Incluye además un módulo de automatización general (Automation Studio).

- **Producción:** https://sac.wiwo.me. Cada push a `main` se despliega solo (ver [Despliegue](#despliegue)).
- **Inicio de sesión:** Google, contra una lista de personas autorizadas. No hay usuario y contraseña en producción.
- **Datos:** PostgreSQL en producción y JSON local en desarrollo. Metricool solo se lee, salvo las respuestas que una persona confirma.
- **Aspecto:** el sistema visual del ecosistema WiWO (el Neo Design System de **WiwoMetriQ**, con el wordmark y los tokens de **WiWo for Creators** y la barra superior de **WiwoLab**): menú lateral desplegable con secciones que se contrae a un riel de íconos, logo azul en claro y crema en oscuro, tarjetas neutras y botones píldora. Modo oscuro por defecto y modo claro desde la barra superior. Mientras algo carga se ve el **orb de WIWO** con "Cargando…".
- **Sonido:** el soundbranding WiWO (`public/sonidos/`, `src/lib/sonidos-wiwo.ts`): la firma de marca al entrar, un sonido de éxito al terminar procesos lentos (sincronizar, exportar, importar, acciones en lote) y uno de error cuando falla algo que pidió la persona. Se silencia con el botón de parlante de la barra superior; la preferencia (`localStorage["wiwo-sonidos"]`) es la misma en todas las plataformas WiWO.

---

## Qué llega de cada red

Todo llega a través de **Metricool**. Para que una red aparezca, basta con conectarla en Metricool a la misma marca que está vinculada en wiwo.sac; wiwo.sac detecta sola las redes nuevas en la siguiente actualización.

| Red | Comentarios | Mensajes directos (DM) | Reseñas |
| --- | --- | --- | --- |
| Instagram | Sí | Sí | — |
| Facebook | Sí | Sí | — |
| TikTok | Sí (solo cuentas **Business**) | No | — |
| LinkedIn | Sí | No | — |
| YouTube | Sí | — | — |
| X | — | Sí | — |
| Google Business | — | — | Sí |

- Lo que llega se ve en la **Bandeja SAC**, en **Gestión DMs / Gestión comentarios** (una pestaña por red), en **Reportes**, en el **Excel** y en **MetriQ**.
- Los **DMs de TikTok y LinkedIn** no los ofrece Metricool: se suben a mano con el Excel de la planilla (**Reportes → Cargar TikTok/LinkedIn**).
- **Menciones y etiquetas en fotos** (quién menciona a la marca en un comentario o la etiqueta en una publicación): **por ahora no**. Metricool no las entrega; solo se pueden obtener conectando wiwo.sac directamente con Meta, un proceso más largo que requiere la aprobación de Meta y la autorización de cada marca.

Explicación sin tecnicismos, para el equipo: [docs/GUIA_COMENTARIOS_Y_MENCIONES.md](docs/GUIA_COMENTARIOS_Y_MENCIONES.md).

---

## Qué hay en la web

| Sección | Para qué sirve | Quién la ve (permisos por defecto) |
| --- | --- | --- |
| **Inicio** | Lo que necesita atención primero: tarjetas de conteo en plazo y la cola priorizada a todo el ancho. El Agente ve *sus* casos primero y **Tomar siguiente**. La carga por persona está en la Bandeja (filtro **Asignación → Responsable**) y el estado de sincronizaciones y trabajos en **Ejecuciones**. | Todos |
| **Bandeja SAC** | Una fila por persona y cuenta, ordenada por lo que vence antes. Tiene filtros que se recuerdan, buscador de cuentas, **Mis casos**, filtro por responsable para Supervisor y Admin, plazo *Por atender en plazo*, **Tomar siguiente**, atajos `J`/`K`/`R`/`E`, archivado de casos vencidos y exportación a Excel. El filtro **Spam** oculta por defecto lo que las reglas detectan como spam o ruido (el mismo texto repetido por una cuenta, el mismo texto desde varias cuentas, comentarios que solo etiquetan, spam promocional o de estafas); lo que solo sugiere la IA queda visible con su aviso, y Supervisor y Admin pueden **Descartar spam** en lote tras confirmar (nunca toca Metricool ni casos sensibles). Al abrir un caso, el detalle se abre a la derecha con el resto de la pantalla difuminado; un clic fuera lo cierra (si hay una respuesta sin guardar, primero pregunta). | Todos |
| **Gestión DMs** / **Gestión comentarios** | Trabajo por cuenta, como un chat: cola y conversación lado a lado, actualizadas en vivo. Muestra **quién tiene a cargo** el chat o el post abierto ("A cargo: …", o "Tú"), y el campo de respuesta tiene un **botón de emojis**. Los comentarios se agrupan por publicación, con una pestaña por red (Instagram, Facebook, TikTok, LinkedIn y YouTube); cada publicación dice cuántos comentarios parecen spam, esos van al final de la fila con su aviso, y Supervisor y Admin pueden descartarlos de una vez. | Todos |
| **Resumen SAC** | Totales y rendimiento por marca. | Supervisor, Admin |
| **Reportes** | Cifras del **informe SAC mensual** por marca: casos, respondidos, cobertura, variación contra el mes anterior, motivos, tono y canales. Muestra avisos de datos antes de presentar y descarga el Excel del mes. **Cargar TikTok/LinkedIn** sube el Excel BD SAC con lo que Metricool no trae de esas redes, como sus DMs (permiso *Cargar registros manuales*). | Supervisor, Admin |
| **Clientes** (antes Cuentas) | Tablero de **mensajes recibidos** (por defecto el mes en curso; también por día o por un período de hasta un año) con el desglose por cliente y por red, filtros **En SAC / Todas** y **Cuenta de Metricool**, y debajo el estado de marcas y cuentas con su centro documental. Cuenta los mensajes entrantes sincronizados desde Metricool, por día UTC como Reportes, sin los registros cargados a mano (`source: "planilla"`); incluye spam (los casos SAC están en Reportes). **En SAC** marca qué redes de cada cuenta atiende hoy el equipo: solo etiqueta y filtra, no oculta ni deja de sincronizar; la edita el **admin principal** y se precargó una vez desde la lista del equipo (por nombre y red). Solo Admin puede crear, editar o conectar marcas con Metricool. Solo el **admin principal** puede **ocultar** un cliente (deja de sincronizar y desaparece de la bandeja, Reportes y MetriQ, sin borrar nada) y volver a mostrarlo desde el filtro **Ocultos**. | Supervisor (lectura), Admin |
| **Ejecuciones** (grupo Sistema) | Trabajos de sincronización y envío, y su historial. | Admin |
| **Usuarios** | Personas, roles y permisos. Un **admin principal** puede además ocultarle clientes a una persona (**Clientes que ve**): deja de verlos en toda la web, sin borrar nada. | Admin |
| **Asistente** (orbe flotante abajo a la derecha) | Responde cómo se usa wiwo.sac y qué permite el rol de cada persona, con preguntas sugeridas y la sección abierta como contexto. Solo orienta: no ejecuta acciones ni ve casos. Con la IA apagada responde las preguntas sugeridas con la guía. | Todos |
| **Configuración** | Ajustes del flujo y diagnóstico de la integración. | Supervisor, Admin |

El menú y los botones se muestran según los **permisos** de cada persona, no según el nombre de su rol. Si un Admin le da a alguien un permiso extra, la sección correspondiente le aparece. El servidor vuelve a validar cada acción.

## Roles y permisos

| Rol | Qué puede hacer |
| --- | --- |
| **Lector** | Ver bandejas y conversaciones de sus marcas. |
| **Agente** | Lo anterior, más responder, tomar y soltar casos, notas internas, cambiar estados y actualizar desde Metricool. |
| **Supervisor** | Lo anterior, más asignar casos a otros, archivar vencidos, exportar, ver métricas y reportes, conciliar envíos y ajustar el flujo SAC. |
| **Admin asignado** | Rol Admin dado desde la app. Administra usuarios, credenciales y envío automático, pero **no** puede dar el rol Admin, cambiar a otro admin, editar roles ni otorgar permisos sensibles. |
| **Admin principal** | Correos en `SAC_FLOW_AUTH_ADMIN_EMAILS`. Puede todo, incluido ocultar y mostrar clientes (para todos o solo para una persona) y marcar qué cuentas se usan **En SAC**, y no se puede cambiar desde la app. |

- Lector, Agente y Supervisor son **editables**, y se pueden crear roles propios a partir de ellos. A una persona en particular se le pueden sumar o quitar permisos.
- **Permisos sensibles** (solo los otorga un admin principal): *Gestionar marcas*, *Editar automatizaciones*, *Publicar el flujo SAC*, *Archivar vencidos en lote* y *Exportar a Excel*.
- Nadie puede cambiar su propio rol.

Detalle completo: [docs/PUESTA_EN_MARCHA_REAL.md](docs/PUESTA_EN_MARCHA_REAL.md).

## Cómo fluye un caso

1. **Lectura:** un worker lee Metricool cada cierto intervalo, solo lectura (`SAC_FLOW_INBOX_SYNC_ENABLED`). La web es **en vivo**: la API avisa cada cambio (respuestas, asignaciones, estados, sincronización) y cada navegador baja solo lo que cambió, así contadores como "Por atender en plazo" se actualizan en un segundo sin recargar. En **Gestión DMs/comentarios**, la cuenta abierta se lee además en Metricool cada 15 segundos, así los mensajes del cliente y del chatbot aparecen solos en el chat, sin pulsar **Actualizar cuenta**. También ofrece **Actualizar ahora**.
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

**TikTok y LinkedIn:** Metricool trae sus comentarios (TikTok solo de cuentas Business), que entran a la bandeja y a Gestión comentarios como los de las demás redes, pero no sus DMs ni lo que el equipo lleva en la planilla. Para eso, con **Cargar TikTok/LinkedIn** se sube el Excel BD SAC de la marca (un caso por fila, como la planilla de siempre). Primero se revisa qué entra y qué se omite, y recién al confirmar se guarda. Esos casos cuentan en el reporte y llegan a MetriQ, pero no aparecen en la bandeja porque ya se atendieron fuera de wiwo.sac. Subir el mismo archivo otra vez no duplica nada.

Antes de presentar, la sección avisa de datos dudosos: mensajes sin clasificar, cuentas duplicadas (dos marcas apuntando al mismo usuario) o una sincronización detenida. El Excel del mes, de todas las marcas o de una, usa los mismos días (UTC) que las cifras e incluye **todas las redes** (la columna *Canal* indica cuál: Instagram, Facebook, TikTok, LinkedIn, YouTube…). Lo cargado a mano desde la planilla aparece con *Fuente* "planilla".

**Caso o ruido:** sin IA, las reglas separan el ruido social (reacciones, menciones, emojis sueltos, textos muy cortos). El equipo corrige a mano desde el detalle de cada caso o en lote desde la Bandeja, y lo marcado a mano manda. La sección muestra cuánto del mes se decidió a mano, con IA o por reglas.

**IA (opcional, apagada por defecto):** la clasificación con IA queda en modo sombra y todavía no cambia estas cifras; ver [Inteligencia artificial](#inteligencia-artificial).

Notas para que los números sean confiables:
- La cobertura cuenta solo casos **respondidos**: archivar casos vencidos no la infla.
- Al vincular marcas, una marca de Metricool cuyo Instagram ya está vinculado se omite, para no contar mensajes dos veces.
- Las marcas desactivadas no entran en métricas ni reportes.

## Inteligencia artificial

wiwo.sac usa IA con DeepSeek V4.1 Flash a través de BytePlus ModelArk; Claude es una alternativa que se elige por configuración (`SAC_FLOW_AI_PROVIDER=anthropic`). Está **apagada por defecto**: se enciende en el servidor con `SAC_FLOW_AI_ENABLED=true` y `BYTEPLUS_API_KEY`. La clasificación y las recomendaciones además solo funcionan para las marcas autorizadas en `SAC_FLOW_AI_BRAND_IDS`. Detalle de costos y usos en [docs/IA_GASTO_Y_USOS.md](docs/IA_GASTO_Y_USOS.md); plan y decisiones en [docs/PROPUESTA_IA.md](docs/PROPUESTA_IA.md).

### Qué hace hoy

1. **Clasifica cada mensaje que llega, en modo sombra.** Dice si es caso o ruido, la categoría, el tono, si hay que derivarlo, si es sensible y qué tipo de ruido es. Lo hace el worker cada 5 minutos y el resultado queda aparte (`aiTriage`), sin cambiar Reportes ni la Bandeja. La concordancia con lo que marca el equipo se consulta en `GET /api/ai/agreement?month=AAAA-MM`.
2. **Manda a revisión humana los casos delicados** (legal, salud, fraude, reclamos graves). Solo puede sumar revisión, nunca quitarla.
3. **Recomienda respuestas** en la Bandeja y en Gestión DMs/comentarios, basadas en el QA aprobado de la marca. Cita sus fuentes y advierte las cifras o enlaces que no están en el QA. Pasa al campo de respuesta solo con *Usar recomendación* y nunca se envía sola. Sin IA, el recuadro muestra la sugerencia por reglas, rotulada como tal.
4. **Detecta spam** (promocional, estafas, cadenas de concurso), sumado a las reglas que funcionan sin IA: comentario repetido, mismo texto desde varias cuentas, solo etiquetas. Lo que solo sugiere la IA se muestra con su aviso, pero no se oculta.
5. **Responde dudas de uso** con el **Asistente de wiwo.sac**, el orbe flotante abajo a la derecha, según el rol de cada persona. Solo orienta: no hace cambios ni ve casos.

### Qué podría hacer después

Ordenado de lo más listo a lo que requiere más trabajo:

- **Contar en Reportes**, cuando la concordancia con las marcas manuales lo justifique. Falta mostrar esa concordancia en pantalla (hoy solo está en la API) y decidir el umbral.
- **Redactar la lectura del mes** en Reportes: un borrador del análisis y dos próximos pasos por marca. El código ya existe (`server/sac-editorial.ts`); falta conectarlo a la pantalla.
- **Resumir conversaciones largas**, útil para traspasos entre turnos.
- **Detectar vacíos del QA:** preguntas frecuentes sin respuesta aprobada, para proponérselas a la marca.
- **Traducir** los mensajes que llegan en otro idioma.

### Limitaciones

**De funcionamiento**

- **Nunca envía ni decide por su cuenta.** Toda respuesta la envía una persona, y el envío automático es un interruptor aparte que sigue apagado.
- **La clasificación todavía no cuenta en el reporte.** Hasta medir su concordancia, el reporte sigue usando las reglas y lo marcado a mano.
- **Solo lee texto.** No ve imágenes, audios, stickers ni historias.
- **Ve un recorte de cada caso.** Clasifica hasta 600 caracteres por mensaje y mira los últimos 7 días, hasta 100 mensajes cada 5 minutos. Las recomendaciones usan los últimos 10 mensajes del hilo.

**De calidad**

- **La recomendación es tan buena como el QA de la marca.** No conoce stock, precios ni el estado de un pedido. Sin un QA que cubra la consulta, responde que el equipo lo revisará o pide el dato que falta, en vez de inventar.
- **Se puede equivocar.** DeepSeek Flash es rápido y barato, no el modelo más capaz. Por eso nada se aplica solo. Cambiar de modelo, o pasar a Claude, es solo configuración.
- **Las reglas de spam pueden marcar algo legítimo**, como un concurso real. Por eso descartar es manual, se confirma y se puede reabrir.
- **El asistente solo sabe lo que dice su guía de uso** (`SAC_GUIDE` en `server/help-assistant.ts`). No ve datos ni el estado real de las cuentas, y hay que actualizar la guía cuando cambie una función. Sin IA responde solo sus cuatro preguntas sugeridas.

**De privacidad y costo**

- **Los textos de clientes salen a BytePlus**, que puede procesarlos en Malasia, Indonesia o la UE. Antes de autorizar cada marca hace falta su visto bueno al tratamiento de datos fuera de Chile.
- **El enmascarado no anonimiza del todo.** Quita correos, teléfonos, RUT, tarjetas, usuarios y enlaces, pero un texto libre todavía puede identificar a alguien. El asistente de ayuda no envía datos de clientes.
- **El costo es bajo pero no tiene tope automático.** Son unos USD 3 al mes con unos 5.000 mensajes y 5.000 recomendaciones. La tarifa de BytePlus hay que confirmarla en su consola, y mientras no haya tope automático de gasto conviene una alerta de facturación en BytePlus.

**Detalles técnicos**

- **Se pierde al reiniciar la API:** la caché de recomendaciones y el contador del límite del asistente (30 preguntas por persona cada 10 minutos).
- **Se pierde al recargar la página:** la conversación con el asistente.
- **Está ajustada para español de Chile.** En otros idiomas clasifica con menos confianza.

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

- **Producción** (`docker-compose.production.yml`): PostgreSQL, migraciones (`migrate`), API, worker y respaldo diario de la base (`backup`). La API sirve la web compilada en el puerto 8787 y responde 404 real para `/api/*` desconocidas.
- **Respaldos:** `pg_dump` diario en `/var/backups/sac-flow` (fuera del volumen de Docker), con 14 días de retención y restauración en una sola transacción. Ver [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md#respaldos-de-la-base).
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
- TikTok: solo llegan comentarios de cuentas **Business**. TikTok y LinkedIn no traen DMs.
- Menciones y etiquetas en fotos de Instagram no llegan por Metricool (requieren una conexión directa con Meta).
- Plazos informados por Metricool: 24 h para comentarios y 7 días para DMs. Fuera de plazo se puede intentar, pero Metricool o Meta pueden rechazar la respuesta.
- El proveedor de Instagram debe coincidir con cómo se conectó la cuenta en Metricool (`INSTAGRAMBUSINESS` o `INSTAGRAM`).

Configuración: [docs/METRICOOL_SETUP.md](docs/METRICOOL_SETUP.md).

## Seguridad

- El token de Metricool, el secreto de Google y la clave del proveedor de IA (`BYTEPLUS_API_KEY`) viven solo en el `.env` del servidor o en el gestor de secretos. Nunca en el navegador, respuestas HTTP, Excel, logs, capturas ni commits.
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
| [GUIA_COMENTARIOS_Y_MENCIONES.md](docs/GUIA_COMENTARIOS_Y_MENCIONES.md) | Para el equipo, sin tecnicismos: qué redes llegan, qué conectar en Metricool y por qué aún no hay menciones ni etiquetas |
| [IA_GASTO_Y_USOS.md](docs/IA_GASTO_Y_USOS.md) | Para el equipo: qué hace la IA (DeepSeek vía BytePlus), qué no hace y cuánto cuesta al mes |
| [PROPUESTA_IA.md](docs/PROPUESTA_IA.md) | Propuesta técnica de IA por fases: casos de uso, datos personales, permisos y estado de implementación |
| [PUESTA_EN_MARCHA_REAL.md](docs/PUESTA_EN_MARCHA_REAL.md) | Inicio de sesión, roles, menú por permiso, Reportes, paso a live |
| [OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md) | Operación diaria, plazos, incidentes y rollback |
| [API_CONTRACT.md](docs/API_CONTRACT.md) | Contrato HTTP de la API |
| [LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) | Desarrollo local y usuarios de prueba |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura de web, API, worker y repositorios |
| [METRICOOL_SETUP.md](docs/METRICOOL_SETUP.md) | Configuración de Metricool |
| [POSTGRESQL_MIGRATION.md](docs/POSTGRESQL_MIGRATION.md) | Paso de JSON a PostgreSQL |
| [SECURITY.md](docs/SECURITY.md) | Seguridad y privacidad |
| [HANDOFF_TECHLAB.md](docs/HANDOFF_TECHLAB.md) | Traspaso a Techlab |
| [INTEGRACION_METRIQ.md](docs/INTEGRACION_METRIQ.md) | API de solo lectura para MetriQ: marcas, filas SAC, totales, reporte y Excel del mes |
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
