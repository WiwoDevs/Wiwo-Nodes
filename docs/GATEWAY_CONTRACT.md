# Contrato del gateway para integrar SAC Flow

Este contrato define la frontera temporal entre la página existente, su gateway/BFF y SAC Flow. Debe reemplazarse o complementarse con la arquitectura de identidad aprobada por Techlab antes de producción.

## Topología esperada

El navegador accede a una única URL HTTPS del portal. El gateway enruta el prefijo acordado hacia SAC Flow, termina TLS, valida la sesión corporativa y construye el contexto confiable. La API no debe quedar accesible directamente desde Internet.

## Cabeceras confiables

Antes de enviar una solicitud a SAC Flow, el gateway debe **eliminar cualquier valor recibido del navegador** para estas cabeceras y volver a crearlas desde la sesión validada:

| Cabecera | Regla |
| --- | --- |
| `X-SAC-User-Id` | ID opaco y estable del usuario autenticado |
| `X-SAC-User-Name` | Nombre visible; no usar como identificador |
| `X-SAC-Tenant-Id` | Tenant/organización autorizado |
| `X-SAC-Role` | `viewer`, `agent`, `supervisor` o `admin` |
| `X-SAC-Brand-Ids` | `*` o lista separada por comas construida desde permisos |
| `X-Request-Id` | UUID/ID de correlación nuevo o validado por el gateway |
| `X-API-Key` | Secreto interno gateway → API; nunca se entrega al navegador |

No se deben reenviar `Authorization`, cookies de sesión ni cabeceras `X-SAC-*` controladas por el cliente salvo la traducción explícita anterior.

## Origen, CORS y mutaciones

- Configurar `SAC_FLOW_CORS_ORIGINS` con los orígenes HTTPS exactos del portal cuando frontend y API no sean same-origin.
- Mantener `SAC_FLOW_ENFORCE_ORIGIN_CHECK=true` en staging y producción.
- `POST`, `PUT`, `PATCH` y `DELETE` con `Origin` no permitido o `Sec-Fetch-Site: cross-site` reciben `403 ORIGIN_NOT_ALLOWED`.
- Clientes servidor-servidor pueden omitir `Origin`, pero siguen sujetos a API key, rol, scope, rate limit e idempotencia.
- No usar `*` en CORS productivo.

## Enrutamiento y límites

| Tráfico | Recomendación inicial |
| --- | --- |
| UI y assets | Cache según hash; `index.html` sin cache durable |
| `/api/health` | Liveness, sin autenticación; timeout 2 s |
| `/api/ready` | Readiness, sin autenticación; timeout 3 s |
| Lecturas API | Timeout 15 s; no reintentar automáticamente errores 4xx |
| Mutaciones locales | Timeout 15 s; reintentar solo con operación/idempotencia segura |
| `/api/sync` | Timeout 60 s en MVP; migrar a job asíncrono antes de carga sostenida |
| `/api/export/xlsx` | Timeout 60 s y límite de descarga por usuario |
| Respuestas live | `Idempotency-Key` obligatoria; nunca reintentar con una key nueva |

El gateway debe conservar `X-Request-Id` en respuesta y logs, limitar el cuerpo de solicitudes, no registrar payloads ni secretos y devolver errores JSON sin páginas HTML intermedias.

## Respuestas mínimas que debe preservar

- `401`: sesión/API key ausente o inválida.
- `403`: rol, marca u origen no autorizado.
- `409`: conflicto de versión, idempotencia o guardrail operativo.
- `423`: cortacorriente de envíos activo.
- `428`: falta `Idempotency-Key` en una operación live.
- `429`: rate limit; preservar `Retry-After`.
- `502`: error sanitizado del proveedor.
- `503`: dependencia/configuración no disponible.

## Pruebas de aceptación

1. Un usuario de una marca no puede leer ni mutar casos de otra marca.
2. Cabeceras `X-SAC-*` enviadas desde el navegador son reemplazadas, no concatenadas.
3. Un `Origin` ajeno recibe 403 y el origen permitido funciona.
4. Deep links y refresh conservan la sesión y el prefijo final.
5. Dos actualizaciones con la misma versión producen un éxito y un `409 VERSION_CONFLICT`.
6. Repetir un envío con la misma `Idempotency-Key` no duplica la respuesta externa.
7. Logs del gateway/API permiten buscar por `X-Request-Id` sin texto, handle, token ni IDs privados de Metricool.
