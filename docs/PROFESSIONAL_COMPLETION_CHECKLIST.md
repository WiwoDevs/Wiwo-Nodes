# Lista profesional de funciones y brechas pendientes

## Propósito

Esta es la lista maestra para convertir Flow Studio y su módulo principal SAC Flow desde una beta local en un servicio profesional integrado a una página web existente. Cubre tanto automatización general como la operación de unas 20 cuentas de Instagram/Facebook mediante Metricool.

La presencia de código, una pantalla o una prueba local no equivale a una aprobación de producción. Cada punto se considera terminado solo cuando se cumple su criterio de aceptación en el entorno real de Techlab y existe evidencia adjunta.

Prioridades:

- **P0 — piloto real:** bloquea el uso con conversaciones reales o respuestas externas.
- **P1 — producción profesional:** bloquea el lanzamiento general o una operación sostenible.
- **P2 — escala/madurez:** no bloquea el primer lanzamiento controlado, pero sí crecimiento, eficiencia o gobierno avanzado.

Estados:

- **Parcial:** el MVP ya contiene una base útil, pero falta evidencia o infraestructura real.
- **Implementado en MVP:** existe código, UI y pruebas locales; aún debe validarse dentro del entorno real de Techlab.
- **Pendiente externo:** depende de credenciales, decisiones, sistemas o personal de Techlab/Metricool/Meta.
- **Pendiente:** puede implementarse sobre esta base, pero aún no está incluido.

## Qué ya entrega el MVP

La entrega actual incluye shell general, editor visual, catálogo inicial de 34 nodos, motor DAG, triggers manual/horario/webhook/formulario/error, proyectos/carpetas/tags, plantillas, credenciales/variables cifradas, versiones/publicación/activación, ejecuciones/reintentos, API/webhooks y worker. El módulo SAC conserva la UI React, demo de 20 marcas, bandeja, auditoría, borradores, estados, Metricool, XLSX, cuentas, roles, guardrails y controles de respuesta.

También existe integración continua para ejecutar typecheck, build, pruebas API/Sites/E2E, validación de migraciones, audit de dependencias, SBOM y smoke del compose productivo. El header `X-Request-Id` correlaciona solicitudes sin reutilizar texto ni identificadores del cliente.

## 1. Metricool, Meta y alta de las 20 cuentas

| ID | Prioridad | Estado | Función o requisito faltante | Criterio de aceptación | Responsable sugerido |
| --- | --- | --- | --- | --- | --- |
| MTR-01 | P0 | Pendiente externo | Confirmar plan Metricool Advanced/Custom y acceso autorizado al Inbox API | Contrato activo, token emitido por canal seguro y endpoints requeridos habilitados | Negocio + Metricool |
| MTR-02 | P0 | Pendiente externo | Inventario definitivo de las 20 marcas | Matriz aprobada con owner, redes, zona horaria, referencia de cuenta, estado y responsable; sin token en documentos | Operaciones SAC |
| MTR-03 | P0 | Parcial | Conectar referencias reales por cuenta | Las 20 cuentas pueden guardarse/cambiarse por un admin autorizado; las referencias quedan cifradas y nunca llegan al navegador/log | Backend + Seguridad |
| MTR-04 | P0 | Parcial | Validación contractual del API real de Metricool | OpenAPI oficial y rutas verificadas; falta que pruebas con token en staging confirmen permisos, volumen, errores y límites de una cuenta real | Integraciones |
| MTR-05 | P0 | Parcial | Prueba end-to-end de lectura | Para una marca piloto entran DMs y comentarios reales, se deduplican y conservan timestamps/IDs sin perder ni duplicar casos | QA + SAC |
| MTR-06 | P0 | Parcial | Prueba end-to-end de respuesta manual | Un agente autorizado responde un DM y un comentario elegibles; se confirma entrega y se audita el resultado | QA + SAC |
| MTR-07 | P0 | Pendiente externo | Verificar limitaciones por red/cuenta | UAT documenta inbox principal, comentarios de anuncios no respondibles y ventanas 24 h/7 días con casos reales controlados | Producto + SAC |
| MTR-08 | P1 | Pendiente | Renovación/rotación de token sin caída | Runbook probado rota el secreto, valida conectividad y permite rollback sin exponerlo | Plataforma + Seguridad |
| MTR-09 | P1 | Parcial | Monitoreo de cuota y rate limits del proveedor | El cliente conserva `Retry-After`, el outbox reprograma durably y el worker enfría solo esa cuenta; faltan consumo/cuotas reales, dashboard por cuenta y alerta conectada | SRE + Integraciones |
| MTR-10 | P1 | Pendiente | Reconciliación periódica | Job compara conteos/IDs con Metricool y genera alerta ante brechas o duplicados | Datos + Integraciones |

## 2. Operación SAC multiagente

| ID | Prioridad | Estado | Función o requisito faltante | Criterio de aceptación | Responsable sugerido |
| --- | --- | --- | --- | --- | --- |
| SAC-01 | P0 | Parcial | Asignación de casos a agentes/equipos | Ya existe toma/liberación, transferencia por supervisor, filtro y auditoría; faltan directorio real, equipos/colas y UAT multiagente | Producto + Backend |
| SAC-02 | P0 | Implementado en MVP | Notas internas separadas de respuestas | Agentes agregan notas no enviables; nunca se transmiten a Metricool ni se confunden con un borrador | Producto |
| SAC-03 | P0 | Implementado en MVP | Prevención de colisión | UI/API usan `version`/`expectedVersion`; una escritura antigua recibe 409 y debe recargar antes de guardar | Frontend + Backend |
| SAC-04 | P0 | Implementado en MVP | Estados y motivos operativos configurables | API publica catálogos para pendiente/escalado/resuelto; exige códigos válidos, nota para `other` y conserva actor/fecha/auditoría; falta aprobación final del catálogo en UAT | SAC + Producto |
| SAC-05 | P1 | Pendiente | Etiquetas, prioridad y búsqueda avanzada | Se pueden filtrar y reportar tags, prioridad, responsable, SLA y campos de negocio sin degradar rendimiento | Producto + Datos |
| SAC-06 | P1 | Pendiente | Respuestas rápidas versionadas | Plantillas por marca/categoría tienen propietario, aprobación, variables permitidas, vigencia e historial | SAC + Legal/Marca |
| SAC-07 | P1 | Pendiente | SLA y vencimientos | Se definen primera respuesta/resolución; hay temporizador, alertas y reportes por marca/equipo | Operaciones SAC |
| SAC-08 | P1 | Pendiente | Historial conversacional completo y paginado | El agente ve contexto suficiente, orden estable y carga incremental sin exponer otras marcas | Backend + UX |
| SAC-09 | P1 | Pendiente | Adjuntos y tipos de mensaje | Se define soporte/limitación para imagen, video, audio, enlaces y archivos; validación de tamaño/tipo/retención | Producto + Seguridad |
| SAC-10 | P1 | Parcial | Bandeja de errores operables | `Ejecuciones` ya muestra la DLQ general con causa, intentos, próxima acción y retry autorizado; falta bajar el fallo parcial a marca/interacción y cerrar UAT operacional | Producto + SRE |
| SAC-11 | P2 | Pendiente | Encuesta/medición de calidad y QA de agentes | Muestreo, revisión y score de calidad tienen permisos, trazabilidad y métricas acordadas | SAC + Analítica |

## 3. Automatizaciones y respuestas

| ID | Prioridad | Estado | Función o requisito faltante | Criterio de aceptación | Responsable sugerido |
| --- | --- | --- | --- | --- | --- |
| AUT-01 | P0 | Implementado en MVP | Worker/planificador durable | Polling corre fuera del proceso web, con cola durable, lease distribuido y una sola ejecución efectiva por cuenta/intervalo | Plataforma |
| AUT-02 | P0 | Parcial | Reintentos con backoff y cola de fallos | Leasing, backoff, límite, estado `dead`, recuperación PostgreSQL, UI operable y señales/umbrales alertables implementados; falta desplegar las alertas y ejecutar caos con reinicio abrupto | Backend + SRE |
| AUT-03 | P0 | Parcial | Reglas por marca | Confianza, horarios, categorías sensibles, allowlist y plantillas se versionan/aprueban por cuenta, no solo globalmente | Producto + Backend |
| AUT-04 | P0 | Parcial | Activación segura | Producción inicia draft-only; autoenvío exige aprobación doble, allowlist no vacía, UAT firmado y kill switch probado | SAC + Seguridad |
| AUT-05 | P0 | Parcial | Idempotencia durable real | Outbox, lease exclusivo, estado incierto y conciliación pasan un smoke concurrente en PostgreSQL; falta confirmar con Metricool real que dos solicitudes producen como máximo un envío externo | Backend + QA |
| AUT-06 | P0 | Implementado en MVP | Política de categorías prohibidas | Reclamos, pagos/fraude, legal, amenazas, salud, seguridad y datos personales siempre requieren humano, no pueden quitarse por configuración y tienen pruebas negativas | SAC + Legal |
| AUT-07 | P1 | Pendiente | Horario/calendario por marca | Zona horaria, feriados y horario especial se aplican de forma determinista y probada | Operaciones SAC |
| AUT-08 | P1 | Implementado en MVP | Versionado y rollback de workflows | Cada cambio crea borrador, publicar registra actor/fecha y rollback crea una versión nueva desde un snapshot aprobado | Producto + Backend |
| AUT-09 | P1 | Parcial | Modo sombra/canary | `shadow` ya calcula sin enviar y `live` exige allowlist, publicación, outbox y doble cortacorriente; faltan métricas de comparación, aprobación de UAT y progresión probada 1 → 4 → 20 cuentas | QA + SAC |
| AUT-10 | P2 | Implementado en beta | Constructor general tipo n8n | Editor, catálogo, credenciales cifradas, variables, subflows, triggers, versiones, historial y worker ya existen; faltan las capacidades de madurez de la sección 3B | Producto |

## 3B. Madurez de la plataforma general

| ID | Prioridad | Estado | Función o requisito faltante | Criterio de aceptación | Responsable sugerido |
| --- | --- | --- | --- | --- | --- |
| GEN-01 | P0 | Parcial | Persistencia relacional del dominio general | Proyectos, workflows, versiones, credenciales, ejecuciones y node runs usan tablas normalizadas/particionadas; migración desde JSONB verificada sin pérdida | Backend + DBA |
| GEN-02 | P0 | Pendiente | Autenticación de webhooks por workflow | Cada webhook admite secreto/HMAC, rotación, replay protection, idempotencia, cuotas y desactivación inmediata | Seguridad + Backend |
| GEN-03 | P0 | Parcial | Cancelación, timeout y concurrencia durable | API/worker aplican timeout real, cancelación cooperativa y límite por workflow/tenant incluso tras reinicio | Backend + SRE |
| GEN-04 | P0 | Parcial | Vault administrado y rotación | Secret manager externo, envelope encryption, versiones, rotación y auditoría reemplazan claves estáticas de entorno | Seguridad + Plataforma |
| GEN-05 | P1 | Pendiente | OAuth2 completo | PKCE/callback, refresh, scopes, expiración, revocación y errores se prueban con proveedores autorizados | Integraciones + Seguridad |
| GEN-06 | P1 | Pendiente | SDK y sandbox de nodos | Contrato versionado, permisos, cuotas, aislamiento, firma y suite de compatibilidad permiten nodos propios sin ejecutar código arbitrario en API/worker | Plataforma + AppSec |
| GEN-07 | P1 | Pendiente | Debugger avanzado | Pin data, ejecución desde/hasta nodo, breakpoints, comparación de runs y replay no causan efectos externos accidentales | Producto + Backend |
| GEN-08 | P1 | Pendiente | Esperas y continuations largas | Wait persiste estado, despierta por tiempo/evento, expira y puede cancelarse sin ocupar un worker | Backend |
| GEN-09 | P1 | Parcial | Operación profesional de flujos de error | Dispatch dedicado, contexto seguro, límite de recursión, DLQ visible y métricas alertables están implementados; falta desplegar alertas y configurar política de reintento por workflow | Backend + SRE |
| GEN-10 | P1 | Pendiente | Source control y promoción | Export/diff/import firmado, ambientes, aprobación y rollback semántico no exponen secretos ni IDs incompatibles | Plataforma + Producto |
| GEN-11 | P1 | Pendiente | Colaboración y sharing | Membership por proyecto, roles, ownership, comentarios, historial de cambios y conflictos simultáneos tienen pruebas cross-tenant | Identidad + Producto |
| GEN-12 | P1 | Pendiente | Búsqueda, paginación y retención de ejecuciones | Consultas grandes mantienen p95; payloads/node runs se particionan, archivan y borran según política | Backend + DBA |
| GEN-13 | P1 | Pendiente | Formularios públicos profesionales | Renderer, validación, branding, antiabuso, archivos y consentimiento funcionan sin convertir API en un proxy abierto | Producto + Seguridad |
| GEN-14 | P2 | Pendiente | Marketplace gobernado | Instalación, firma, trust policy, escaneo, compatibilidad, actualización y rollback de paquetes están definidos | Plataforma + AppSec |
| GEN-15 | P2 | Pendiente | Catálogo ampliado de integraciones | Prioridades reales determinan conectores mantenidos con pruebas contractuales; no se promete replicar todo el catálogo de n8n | Producto + Integraciones |

## 4. Datos, PostgreSQL y Excel

| ID | Prioridad | Estado | Función o requisito faltante | Criterio de aceptación | Responsable sugerido |
| --- | --- | --- | --- | --- | --- |
| DAT-01 | P0 | Parcial | PostgreSQL administrado real | Migraciones aplicadas en staging; adapter pasa pruebas de contrato, concurrencia, rollback y RLS con datos de prueba | DBA + Backend |
| DAT-02 | P0 | Parcial | Migración y reconciliación del JSON | Auditoría pre/post coincide por marca/cuenta/tipo/estado; respaldo y rollback restauran el estado esperado | DBA + QA |
| DAT-03 | P0 | Pendiente | Backups, restore y objetivos RPO/RTO | Política aprobada y simulacro restaura staging dentro de objetivos medidos | Plataforma + Negocio |
| DAT-04 | P0 | Pendiente | Retención, anonimización y borrado | Jobs aplican plazos por tipo de dato, contemplan backups/exportaciones y generan evidencia auditable | Privacidad + Backend |
| DAT-05 | P0 | Parcial | Auditoría append-only completa | Exportar, configurar, asignar, aprobar, responder y borrar generan eventos con actor, request ID y razón; agentes no pueden editarlos | Seguridad + Backend |
| DAT-06 | P1 | Pendiente | Exportaciones controladas | Filtros, límite, autorización, auditoría, expiración y borrado automático; el XLSX sigue neutralizando fórmulas | Datos + Seguridad |
| DAT-07 | P1 | Pendiente | Índices y presupuesto de consultas | Pruebas con volumen esperado cumplen p95 acordado y no hacen scans tenant-crossing | DBA + Backend |
| DAT-08 | P1 | Pendiente | Migraciones en CI/CD con rollback | Cambios de esquema se revisan, prueban en copia y se promueven antes del código compatible | Plataforma + DBA |
| DAT-09 | P2 | Pendiente | Archivo histórico/warehouse | Datos analíticos minimizados salen por pipeline gobernado, no por consultas a producción | Datos |

## 5. Identidad, seguridad y privacidad

| ID | Prioridad | Estado | Función o requisito faltante | Criterio de aceptación | Responsable sugerido |
| --- | --- | --- | --- | --- | --- |
| SEC-01 | P0 | Pendiente externo | SSO/OIDC o sesión BFF real | Login, logout, expiración, revocación y sesión simultánea se prueban en staging; no hay tokens en `localStorage` | Identidad + Backend |
| SEC-02 | P0 | Parcial | RBAC/tenant derivado de identidad | Rol y marcas provienen de claims/sesión firmada; el gateway elimina `X-SAC-*` del cliente; casos cross-tenant dan 403 | Seguridad + Backend |
| SEC-03 | P0 | Pendiente externo | Gestor de secretos | Token Metricool, API keys y clave de cifrado se inyectan por referencia administrada, con acceso mínimo y auditoría | Plataforma + Seguridad |
| SEC-04 | P0 | Parcial | CSRF/cookies/CORS/TLS del entorno real | API rechaza mutaciones cross-site por Origin/Fetch Metadata y admite allowlist exacta; faltan TLS/cookies/sesión y pruebas sobre el gateway real | Seguridad |
| SEC-05 | P0 | Parcial | Redacción de logs y telemetría | Escaneo de staging confirma ausencia de token, headers, cuerpos, texto, handles, email/teléfono e IDs confidenciales | SRE + Privacidad |
| SEC-06 | P0 | Pendiente externo | Evaluación de privacidad y base de tratamiento | Finalidad, acceso, retención, derechos, encargados y residencia quedan aprobados por responsables competentes | Legal/Privacidad |
| SEC-07 | P0 | Pendiente | Prueba de penetración y threat model firmado | Hallazgos críticos/altos cerrados; riesgos aceptados tienen dueño y vencimiento | Seguridad |
| SEC-08 | P1 | Parcial | Escaneo continuo de dependencias, secretos, SAST e imagen | CI bloquea dependencias altas y genera SBOM CycloneDX; falta SAST/secret scan/attestation del registry definitivo | AppSec + Plataforma |
| SEC-09 | P1 | Pendiente | Permisos elevados para acciones críticas | Cambiar credenciales, autoenvío, retención o roles requiere privilegio explícito y reautenticación según política | Seguridad + Producto |
| SEC-10 | P1 | Pendiente | Runbook de incidente ensayado | Tabletop prueba kill switch, revocación, delimitación, notificación, recuperación y reactivación piloto | Seguridad + SAC |

## 6. Integración con la página web existente

| ID | Prioridad | Estado | Función o requisito faltante | Criterio de aceptación | Responsable sugerido |
| --- | --- | --- | --- | --- | --- |
| WEB-01 | P0 | Pendiente externo | Elegir ruta o subdominio y ownership | ADR aprobada define URL, gateway, equipo dueño, entornos y soporte | Arquitectura |
| WEB-02 | P0 | Parcial | Base path y API base reales | Assets, API, refresh y deep links funcionan bajo el prefijo final; ningún dominio está hardcodeado | Frontend + Plataforma |
| WEB-03 | P0 | Pendiente externo | Integración SSO y navegación | El portal abre SAC Flow con sesión válida, retorno/breadcrumbs y logout coherentes | Portal + Identidad |
| WEB-04 | P0 | Parcial | Contrato de gateway | `GATEWAY_CONTRACT.md` define rutas, timeouts, headers confiables, origen, request ID, errores y aceptación; falta implementarlo/probarlo en el gateway real | Plataforma + Backend |
| WEB-05 | P1 | Pendiente externo | Sistema visual del portal | Tokens, tipografía, navegación, estados y responsive pasan revisión de diseño sin romper independencia del módulo | Diseño + Frontend |
| WEB-06 | P1 | Pendiente | Deep links estables | Marca, bandeja, filtro y caso tienen URL compartible/autorizada y sobreviven al refresh | Frontend |
| WEB-07 | P1 | Pendiente | Estados de sesión/permiso/mantenimiento | UI distingue 401, 403, dependencia caída, mantenimiento y error recuperable con acción clara | UX + Frontend |
| WEB-08 | P1 | Pendiente | Compatibilidad de navegador y dispositivos | Matriz acordada pasa Chrome/Edge/Safari y resoluciones objetivo | QA |
| WEB-09 | P1 | Pendiente | Accesibilidad WCAG | Auditoría teclado/foco/lector/contraste y pruebas manuales cumplen el nivel acordado, idealmente WCAG 2.2 AA | QA + Diseño |
| WEB-10 | P2 | Pendiente | Integración de ayuda/contexto | Enlaces a runbooks, estado del servicio y soporte aparecen según rol sin filtrar información interna | Producto |

## 7. Observabilidad, confiabilidad y soporte

| ID | Prioridad | Estado | Función o requisito faltante | Criterio de aceptación | Responsable sugerido |
| --- | --- | --- | --- | --- | --- |
| OPS-01 | P0 | Parcial | Logs centralizados correlacionables | `X-Request-Id` aparece en gateway/API/worker; búsquedas no requieren texto del mensaje | SRE |
| OPS-02 | P0 | Parcial | Dashboards y alertas | Se observan disponibilidad, p95, errores, cola, sync por marca, duplicados, envíos, 429 y ventanas expiradas | SRE + SAC |
| OPS-03 | P0 | Pendiente | SLO/SLI y guardia | Objetivos de disponibilidad/frescura/envío tienen umbrales, alertas accionables y responsable | Negocio + SRE |
| OPS-04 | P0 | Pendiente | Health/readiness en infraestructura real | Orquestador usa probes correctos y evita tráfico cuando DB no está lista; Metricool caído no provoca loops de reinicio | Plataforma |
| OPS-05 | P0 | Parcial | Prueba del contenedor real | Dockerfile/Compose y smoke CI están definidos; falta ejecutar evidencia local después de reiniciar Windows y confirmar el runner definitivo | Plataforma + QA |
| OPS-06 | P1 | Parcial | Circuit breaker y control de presión | Envíos tienen doble cortacorriente, despacho sombra/live, una entrega concurrente por cuenta, cooldown durable ante 429, breaker ante timeout/5xx y límite atómico/visible de cola automática probado en PostgreSQL; falta conectar las métricas de saturación al sistema de alertas definitivo | Backend + SRE |
| OPS-07 | P1 | Pendiente | Runbooks operativos | Existe diagnóstico/recuperación para DB, Metricool, cola, token, exports y autoenvío | SRE + Integraciones |
| OPS-08 | P1 | Pendiente | Despliegue gradual y rollback | Staging → canary → producción usa artefacto inmutable; rollback probado no pierde datos | Plataforma |
| OPS-09 | P2 | Pendiente | Pruebas de caos controladas | Fallos de red, latencia, reinicio y duplicación demuestran recuperación dentro de SLO | SRE |

## 8. Calidad, CI/CD y aceptación

| ID | Prioridad | Estado | Función o requisito faltante | Criterio de aceptación | Responsable sugerido |
| --- | --- | --- | --- | --- | --- |
| QA-01 | P0 | Parcial | CI activa en repositorio definitivo | Branch protection exige el workflow verde, revisión y ninguna credencial en el repositorio | Plataforma |
| QA-02 | P0 | Pendiente | Entorno staging equivalente | Misma topología/configuración que producción salvo escala y datos; usa secretos y DB separados | Plataforma |
| QA-03 | P0 | Pendiente | UAT firmado por SAC | Guion cubre 20 cuentas, permisos, filtros, borradores, respuestas, fallos, Excel y kill switch | QA + SAC |
| QA-04 | P0 | Parcial | Pruebas contractuales PostgreSQL/Metricool | PostgreSQL real local cubre lease, backpressure y breaker; el simulador HTTP local cubre rutas, payloads, 204/401/429/500/timeout sin red externa. Falta repetir con Metricool real controlado y rollback de staging | QA + Backend |
| QA-05 | P1 | Implementado en MVP | Pruebas E2E de navegador | Playwright cubre desktop/mobile, 18 nodos, ejecución, historial/retry y validación; falta apuntarlo a staging real | QA |
| QA-06 | P1 | Pendiente | Rendimiento y capacidad | Carga equivalente a 20 cuentas más margen cumple presupuesto p95, cola y memoria sin errores | QA + SRE |
| QA-07 | P1 | Pendiente | Estrategia de fixtures | Datos sintéticos reproducibles cubren errores/bordes sin copiar conversaciones reales | QA + Privacidad |
| QA-08 | P1 | Pendiente | Política de releases | Versionado, changelog, aprobación, migración, rollback y comunicación tienen dueño | Producto + Plataforma |
| QA-09 | P2 | Pendiente | Pruebas visuales/regresión | Pantallas críticas detectan cambios de layout y accesibilidad antes del merge | Frontend + QA |

## 9. Gobierno de producto y operación

| ID | Prioridad | Estado | Función o requisito faltante | Criterio de aceptación | Responsable sugerido |
| --- | --- | --- | --- | --- | --- |
| GOV-01 | P0 | Pendiente externo | Dueños y matriz RACI | Cada sistema, secreto, cuenta, incidente, dato y aprobación tiene responsable y suplente | Dirección + Techlab |
| GOV-02 | P0 | Pendiente externo | Política de respuestas y tono por marca | Plantillas, prohibiciones, escalamiento y horarios están aprobados por cada marca | SAC + Marca/Legal |
| GOV-03 | P0 | Pendiente externo | Plan piloto progresivo | Define marca inicial, criterios de avance 1 → 4 → 20, ventana, soporte y rollback | Producto + SAC |
| GOV-04 | P1 | Pendiente | KPIs y definiciones | Tiempo de primera respuesta, resolución, automatización, reapertura y calidad tienen fórmula/fuente/owner | Analítica + SAC |
| GOV-05 | P1 | Pendiente | Capacitación y manual de usuario | Agentes/admins completan práctica de permisos, errores, escalamiento, Excel y kill switch | SAC |
| GOV-06 | P1 | Pendiente | Modelo de soporte | Severidades, canal, horario, tiempos, escalamiento y postmortem están acordados | Techlab + Negocio |
| GOV-07 | P2 | Pendiente | Roadmap posterior al v1 | Priorización explícita decide IA, omnicanalidad, CRM, constructor general y analytics avanzado | Producto |

## Puertas obligatorias de salida

### Gate A — preparado para staging

- [ ] SSO/gateway y PostgreSQL administrado disponibles.
- [ ] Migraciones, secretos y 20 cuentas configurados sin datos sensibles en repositorio.
- [ ] CI obligatoria verde y contenedor real probado.
- [ ] Logs, métricas y alertas conectados.

### Gate B — piloto real draft-only

- [ ] Una marca completa UAT de lectura, borrador, respuesta manual, error y reconciliación.
- [ ] Retención, privacidad, backup/restore e incidente aprobados.
- [ ] Asignación, notas y prevención de colisión disponibles para trabajo multiagente.
- [ ] Kill switch ensayado; autoenvío permanece apagado.

### Gate C — expansión a 4 y 20 cuentas

- [ ] Capacidad, cuotas, colas, SLA y soporte cumplen objetivos.
- [ ] No existen fugas cross-brand ni duplicados bajo concurrencia/reintento.
- [ ] Cada marca tiene templates, categorías prohibidas, horarios y responsables aprobados.
- [ ] Reconciliación y dashboards se mantienen estables durante el período acordado.

### Gate D — auto-respuesta

- [ ] Modo sombra demuestra precisión/seguridad dentro del umbral aprobado.
- [ ] Allowlist por marca, doble aprobación, reglas versionadas y rollback están probados.
- [ ] Temas sensibles siempre derivan a humano y todas las decisiones quedan auditadas.
- [ ] Activación progresiva y apagado global fueron ensayados con Operaciones SAC.

## Definición profesional de “terminado”

Un ítem solo puede marcarse terminado cuando tiene: implementación revisada, pruebas positivas y negativas, evidencia del entorno objetivo, documentación operacional, monitoreo, responsable y procedimiento de rollback. Para el lanzamiento general deben estar cerrados todos los P0 y los P1 que afecten seguridad, datos, continuidad o experiencia de agentes; los P2 pueden permanecer en un roadmap aprobado.
