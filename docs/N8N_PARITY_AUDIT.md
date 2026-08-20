# Auditoría comparativa y overhaul inspirado en n8n

Fecha de corte: 2026-08-12.

## Conclusión

La beta dejó de ser únicamente una herramienta SAC. Ahora incluye una plataforma general de automatización visual llamada **Automation Studio**, mientras **SAC Flow** permanece como el módulo principal y conserva su interfaz operativa especializada.

La referencia técnica fue el checkout local oficial de `n8n-io/n8n` fijado en el commit `cbb55770537b0874f684dab9dda992d461bd577a`. Se estudiaron las fronteras de editor, catálogo, workflow, credenciales, ejecución, triggers, versionado, proyectos, webhooks, worker y persistencia. La implementación de esta beta es original y no copia código de n8n.

No se declara paridad total con n8n. Ese producto mantiene años de desarrollo, numerosos paquetes y un catálogo masivo de integraciones. El estándar de esta beta es una base profesional verificable para construir y operar automatizaciones generales, con un catálogo inicial de nodos ejecutables y SAC integrado como capacidad nativa.

## Frontera de licencia

El repositorio auditado distingue el código cubierto por Sustainable Use License y componentes bajo `.ee` con condiciones Enterprise. Esta beta:

- usa el repositorio únicamente como referencia arquitectónica;
- no copia código, marcas, interfaz exacta ni componentes Enterprise;
- implementa modelos, motor, rutas y UI propios;
- conserva atribuciones de las dependencias utilizadas por el proyecto;
- requiere una revisión legal independiente antes de cualquier estrategia que pretenda incorporar o redistribuir código de n8n.

## Capacidades implementadas en el overhaul

| Área | Implementación actual | Estado beta |
| --- | --- | --- |
| Shell de producto | Inicio general, workflows, ejecuciones, plantillas, credenciales/variables y módulo SAC | Implementado |
| Editor visual | Nodos arrastrables, conexiones, zoom, biblioteca buscable, inspector dinámico y configuración por parámetro | Implementado |
| Modelo de workflow | Proyecto, carpeta, tags, nodos, conexiones, settings, borrador, publicación, activación y archivado | Implementado |
| Catálogo | 34 nodos disponibles: triggers, flujo, transformación, datos, HTTP y SAC | Implementado |
| Motor | DAG topológico, ramas, merge, expresiones, variables, errores, `continueOnFail`, subworkflows y salidas terminales | Implementado |
| Triggers | Manual, horario mediante worker, webhook, formulario y error | Implementado; formulario sin renderer público profesional |
| Datos | Set, filter, sort, limit, aggregate, dedupe, split y fecha/hora | Implementado |
| Flujo | If, switch, merge, procesamiento nativo por item, wait acotado, stop/error, no-op y execute workflow | Implementado; wait/subworkflow en beta |
| HTTP | Solicitudes con credenciales de servidor, timeout, límite de items, bloqueo SSRF y redacción | Implementado y bloqueado por defecto |
| Credenciales | Tipos header/basic/bearer/API key/Metricool, AES-256-GCM, campos validados y claves públicas sin valores | Base implementada; OAuth2 completo pendiente y no se anuncia como disponible |
| Variables | Públicas o secretas, expresiones `$vars`, secretos cifrados | Implementado |
| Ejecuciones | Manual, schedule, webhook, subworkflow, retry, auditoría por nodo, input/output redactado y DLQ operable por rol | Implementado |
| Versiones | Snapshot por edición, publish explícito, activación solo de versión publicada | Implementado |
| Validación | Parámetros, tipos, credenciales, salidas, ciclos, huérfanos, alcance desde trigger y subworkflows | Implementado |
| Worker | Jobs SAC y generales, schedule key idempotente, lease, recuperación, backoff y dead state | Implementado en PostgreSQL |
| Persistencia | JSON local; estado general JSONB tenant-scoped en PostgreSQL con RLS, índice GIN y acceso específico | Implementado para beta |
| API | Contrato `/api/platform/*` y `/api/webhooks/:path`, roles mínimos y errores estructurados | Implementado |
| Portabilidad | Export sin secretos, import con IDs remapeados y rollback desde snapshot | Implementado |
| Seguridad webhook | API key global, reserva idempotente atómica y Bearer/Header adicional por workflow | Implementado base; firma/replay window pendientes |
| Plantillas | Webhook/normalización, calidad de datos y SAC con revisión humana | Implementado |
| Seguridad de desarrollo | HTTP externo, mutaciones Metricool y envíos SAC bloqueables por flags independientes | Implementado y activo por defecto |
| UI SAC | Workflow, dashboard, interacciones, detalle, cuentas y configuración anteriores | Conservado |

## Controles añadidos sobre la referencia genérica

Para este caso, la plataforma incorpora controles de dominio que no deben quedar a criterio de cada creador de workflows:

1. Metricool opera en vista previa dentro del motor general mientras `SAC_FLOW_DISABLE_METRICOOL_MUTATIONS=true`.
2. Los nodos HTTP externos fallan cerrado mientras `SAC_FLOW_DISABLE_EXTERNAL_NODES=true`.
3. El motor redacta tokens, passwords, cookies, Authorization, API keys y los valores secretos conocidos antes de persistir inputs, outputs y node runs.
4. HTTP resuelve DNS y rechaza localhost, link-local y rangos privados para reducir SSRF; producción aún requiere control de egreso contra DNS rebinding.
5. El módulo SAC conserva revisión humana, allowlist, ventanas temporales y kill switch separados.
6. Un workflow automático solo puede activarse si la versión actual está validada y publicada.

## Diferencias importantes respecto de n8n

| Capacidad de una plataforma madura | Estado actual | Trabajo restante |
| --- | --- | --- |
| Catálogo de cientos/miles de integraciones | No incluido | SDK de nodos, loader firmado, sandbox y paquetes mantenidos |
| Ejecución de código arbitrario | No incluida por seguridad | Sandbox aislado, cuotas, permisos y revisión AppSec |
| Debugger con datos pineados y ejecución parcial | Parcial | Pin data, run-from-node, breakpoints y comparación de runs |
| Credenciales OAuth completas | Parcial | Redirect/callback, refresh, scopes, revocación y PKCE |
| Queue distribuida avanzada | Base PostgreSQL y límite transaccional por workflow | Prioridades, cancelación, autoscaling y validación contra PostgreSQL real |
| Colaboración simultánea | No incluida | Presencia, locks/CRDT, comentarios y conflictos de edición |
| Source control/promoción | No incluida en producto | Export firmado, diff semántico, ambientes y aprobación de promoción |
| Formularios públicos | Trigger en beta | Renderer, validación, antiabuso, archivos y branding |
| Error workflows completos | Dispatch automático con contexto seguro, límite de recursión y jobs fallidos visibles en `Ejecuciones` | Alertas operativas, política de reintento por workflow y detalle específico del error workflow |
| Ejecuciones en espera largas | No incluida | Persistir continuation, wakeups, TTL y cancelación durable |
| Multi-tenant enterprise | Base organizacional/RLS | SSO, membership, sharing, cuotas, billing y auditoría append-only |
| Observabilidad distribuida | Parcial | OTEL, logs centralizados, alertas, SLO y perfiles |
| Marketplace/comunidad | No incluida | Firma, trust policy, compatibilidad y revisión de supply chain |

## Gates antes de afirmar estándar productivo

1. Reiniciar Windows y ejecutar el smoke real de `docker-compose.production.yml`.
2. Probar migración `0008_general_automation_platform.sql` contra PostgreSQL real, incluyendo RLS y concurrencia.
3. Completar SSO/OIDC, membership y permisos derivados de identidad, no de headers confiables temporales.
4. Conectar observabilidad, alertas, backup/restore y runbooks del entorno final.
5. Ejecutar pruebas de carga y caos sobre scheduler, webhooks y colas.
6. Someter HTTP node, vault y webhooks a threat model y pentest.
7. Ejecutar UAT de Metricool en una cuenta piloto con las tres protecciones externas activas; cualquier habilitación requiere autorización explícita.
8. Definir retención, borrado y privacidad para datos arbitrarios procesados por workflows generales.

Hasta cerrar esos gates, el estado correcto es **beta general funcional y validada localmente**, no reemplazo completo de n8n ni producción aprobada.
