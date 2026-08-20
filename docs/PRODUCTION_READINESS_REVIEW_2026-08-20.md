# Revisión de preparación para producción — 2026-08-20

## Veredicto ejecutivo

**NO-GO para producción abierta o para operar conversaciones reales de las 20 marcas.**

La base técnica compila, la suite automatizada local pasa y existen controles de seguridad valiosos. Sin embargo, el propio checklist maestro contiene 100 controles y solo 5 P0 aparecen como `Implementado en MVP`; quedan **44 P0 parciales, pendientes o dependientes de terceros**. El principal riesgo no está en que la aplicación “no arranque”, sino en identidad real, aislamiento operativo, datos, UAT con Metricool, observabilidad, respaldo/restauración y gobierno del despliegue.

La salida razonable es un **piloto privado y controlado**, después de cerrar las puertas P0 indicadas en este documento. No corresponde describir el estado actual como producción segura.

## Alcance y evidencia revisada

- Handoff raíz y handoff incluido en el paquete.
- README, arquitectura, seguridad, runbook, contrato API, integración web y checklist profesional.
- Frontend React, API Fastify, worker, repositorios JSON/PostgreSQL, 17 migraciones, Docker y CI.
- Rutas de autenticación/sesión, CORS, origen, rate limit, actor/roles, cifrado, SSRF, idempotencia y outbox.
- Estado local de compilación, pruebas, audit de dependencias, health/readiness y audit interno de seguridad.
- Cambio solicitado en `Gestión manual`; `Bandeja SAC` quedó intacta.

## Resultado de verificaciones locales

| Verificación | Resultado del 2026-08-20 |
| --- | --- |
| Instalación desde lockfile | OK, 327 paquetes instalados |
| TypeScript frontend + API | OK |
| Build frontend + API | OK |
| Pruebas servidor | 175/175 OK en 13 archivos |
| Pruebas Sites | 6/6 OK |
| Migraciones estáticas | 17/17 validadas |
| Audit npm alto | 0 vulnerabilidades conocidas |
| Búsqueda básica de secretos conocidos | Sin coincidencias; no reemplaza secret scanning dedicado |
| Health/readiness demo | API lista con 20 marcas y 60 interacciones ficticias |
| Docker productivo | No verificable: Docker no está instalado en el host de revisión |
| E2E visual | No ejecutado: el navegador integrado no pudo inicializarse y Playwright CLI requiere autorización explícita |

El build actual vuelve a emitir advertencia por un chunk de **581,65 kB minificado / 155,31 kB gzip**. La evidencia del handoff que declara ausencia de esta advertencia y cita tamaños menores está desactualizada.

## Capas de seguridad existentes

### Implementadas y comprobables en código/pruebas

- API key temporal con comparación en tiempo constante y sesión firmada de 8 horas.
- Cookie `HttpOnly`, `SameSite=Strict`, `Secure` cuando la solicitud se detecta como HTTPS y alcance `/api`.
- CORS configurable, control de `Origin`/Fetch Metadata, límite de body de 1 MiB y rate limit en memoria.
- Cabeceras CSP, `X-Content-Type-Options`, `Referrer-Policy` y `X-Frame-Options` en modo seguro.
- Roles `viewer`, `agent`, `supervisor`, `admin`, scope por marca y validación backend.
- RLS PostgreSQL por organización y transacciones tenant-scoped.
- Referencias Metricool cifradas en PostgreSQL y credenciales de Automation Studio con AES-256-GCM.
- Redacción de secretos, IDs de correlación, prevención de fórmulas XLSX y bloqueo de URLs inseguras.
- Kill switches separados, auto-reply en `shadow`, aprobación humana, versión optimista e idempotencia/outbox.
- Protección SSRF básica para nodos HTTP, timeouts y egreso externo bloqueado por defecto.
- Contenedor sin root, filesystem de solo lectura y `no-new-privileges`.

### Faltantes o insuficientes para producción

1. **Identidad real y autorización — P0.** La configuración productiva permite por defecto `SAC_FLOW_TRUST_ACTOR_HEADERS=false`, `SAC_FLOW_REQUIRE_ACTOR_CONTEXT=false` y rol `admin`. Una misma API key termina representando a un administrador local con acceso total. Debe existir OIDC/SSO o BFF/gateway que elimine cabeceras `X-SAC-*` entrantes, reconstruya identidad validada y pruebe roles/tenant/marca con casos negativos.
2. **Repositorio y trazabilidad — P0 operativo.** El handoff no contiene `.git`; la CI existe como archivo, pero no hay historial, commit verificable, rama protegida ni artefacto asociado a un SHA. Se agregó `.gitignore`, pero Techlab debe crear el repositorio oficial y promover artefactos, no carpetas sueltas.
3. **Metricool real — P0.** Falta contrato/plan, inventario definitivo, scopes, lectura real, respuesta manual real, límites por cuenta, idempotencia externa y canary 1 → 4 → 20.
4. **Datos y privacidad — P0.** Faltan política de retención/borrado, caducidad de XLSX, backup cifrado, RPO/RTO y prueba real de restore. La aplicación maneja DMs y potencial PII.
5. **Webhooks — P0.** La autenticación por workflow es parcial; faltan HMAC/secretos rotables, replay protection, cuotas y desactivación inmediata con UAT.
6. **Secretos — P0/P1.** Las claves de entorno son adecuadas para beta, no para multi-tenant productivo. Falta KMS/Vault, envelope encryption y rotación ensayada.
7. **Observabilidad — P0/P1.** Hay endpoint de métricas, pero faltan backend de métricas/logs/trazas, dashboards, alertas accionables y on-call probado. El rate limit en memoria no es distribuido.
8. **Supply chain — P1.** No hay escaneo de secretos ni de imagen en la CI, las imágenes se fijan por tag y no por digest, y no hay licencia/NOTICE del proyecto. `npm ci` mostró dependencias transitivas obsoletas aunque el audit actual no reporta vulnerabilidades.
9. **Continuidad — P0.** Falta probar rollback de aplicación/configuración, pausa segura de worker, restore y reconciliación después de una entrega `uncertain`.
10. **Validación del entorno anfitrión — P0/P1.** Falta ruta/subdominio final, TLS/gateway/CSP aprobados, deep links, expiración de sesión, responsive, teclado, lector de pantalla y zoom en la web real.

## Hallazgos del handoff

- La advertencia principal de `SECURITY.md` es correcta: el sistema sigue siendo beta local y no una certificación de seguridad.
- La evidencia histórica está desactualizada: habla de 100 pruebas y 11 migraciones; la revisión actual encuentra 175 pruebas de servidor y 17 migraciones.
- El README requiere Node 22 LTS; esta revisión local corrió con Node 24.18.0. La imagen/CI apunta a Node 22, pero debe repetirse la recepción en un checkout limpio con esa versión.
- El paquete no trae Docker disponible en el host, por lo que no se verificaron PostgreSQL real, RLS real, migraciones aplicadas, worker, healthchecks, filesystem read-only ni smoke del outbox en contenedores.
- No existe archivo `LICENSE` o `NOTICE`; debe resolverse antes de una distribución formal.
- El audit interno en modo demo marcó 67/100, con fallos esperables de autenticación y controles HTTP por estar ejecutado como demo. Sirve como señal, no como evidencia productiva.

## Cambio de interfaz solicitado

`Gestión manual` quedó simplificada de tres a dos zonas:

1. Cola de publicaciones/conversaciones.
2. Conversación activa y compositor manual.

Se retiró exclusivamente el panel derecho redundante. El contexto imprescindible de la publicación y su enlace oficial se movió dentro de la conversación, y el estado de actualización quedó junto al selector de cuenta. `Bandeja SAC` no se modificó. La prueba E2E fue actualizada para exigir dos columnas, pero queda pendiente la captura visual por el bloqueo del navegador integrado.

## Cambios de endurecimiento aplicados

- Kill switch `SAC_FLOW_DISABLE_OUTBOUND_SENDS=true` en `.env.example`, imagen Docker y compose local; un envío requiere ahora opt-in explícito en esos puntos de entrada.
- `.gitignore` para evitar versionar `.env`, datos, exportaciones, dependencias, builds y reportes.
- Contrato del proyecto y README actualizados para dejar permanente la separación: `Bandeja SAC` se conserva; `Gestión manual` usa dos zonas y contexto inline.

## Plan mínimo de salida

### Puerta 1 — repositorio y entorno

- Crear repositorio Techlab, licencia, CODEOWNERS, protección de rama y CI obligatoria.
- Ejecutar checkout limpio con Node 22, build, 175 pruebas, 30 escenarios E2E, audit, SBOM, secret scan e image scan.
- Construir una vez, identificar artefacto por commit/digest y promover el mismo artefacto.

### Puerta 2 — identidad, datos y secretos

- Integrar OIDC/BFF, eliminar/reconstruir `X-SAC-*`, usar fallback `viewer` y probar denegaciones cross-tenant/cross-brand.
- Activar PostgreSQL real y verificar RLS con dos tenants de prueba.
- Configurar Vault/KMS, rotación, backups, restore, retención, borrado y caducidad de XLSX.

### Puerta 3 — UAT Metricool

- Confirmar plan/scopes y conectar una sola marca piloto.
- Validar lectura repetida sin duplicados y respuesta manual DM/comentario con auditoría e idempotencia.
- Mantener autoenvío apagado y `SAC_FLOW_DISABLE_OUTBOUND_SENDS=true` fuera de la ventana manual autorizada.

### Puerta 4 — operación y go-live

- Activar métricas, dashboards, alertas, on-call, runbook e incidente simulado.
- Probar rollback y restore.
- Canary 1 marca, luego 4 y finalmente 20, con go/no-go firmado en cada etapa.

## Decisión recomendada

Autorizar únicamente un **piloto de staging privado, draft-only y con una marca ficticia o autorizada**, después de cerrar identidad, repositorio, PostgreSQL/backup y observabilidad mínima. No habilitar respuestas automáticas ni exposición pública hasta cerrar todos los P0 aplicables y adjuntar evidencia reproducible.
