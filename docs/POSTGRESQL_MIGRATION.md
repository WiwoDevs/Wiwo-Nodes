# Migración a PostgreSQL

## Estado

`JsonRepository` se conserva para desarrollo local. `docker-compose.production.yml` selecciona obligatoriamente PostgreSQL y separa migrador, API y worker. La frontera vive en `server/repository-contract.ts`; el runtime falla cerrado si alguien intenta `json` en `NODE_ENV=production` + `METRICOOL_MODE=live` sin una excepción explícita. Las migraciones PostgreSQL son el contrato productivo: multi-tenant, auditable, con idempotencia, versiones, cola durable, allowlist por cuenta y RLS.

`SAC_FLOW_REPOSITORY=postgres` crea `PostgresRepository`. Exige URL y clave de cifrado; el adapter usa `pg`, pool, transacciones, contexto tenant, lock transaccional y `pgcrypto`. `npm run migrate` aplica solo archivos nuevos y rechaza cambios de checksum en migraciones aplicadas. Sigue pendiente validar backup/restore y carga con el ambiente administrado definitivo.

Validación local:

```powershell
npm run test:migrations
npm run postgres:audit-json -- .\data\sac-flow.json
```

`test:migrations` revisa orden de archivos, transacciones, tablas requeridas, constraints críticos, RLS por tenant y ausencia de fixtures con pinta de secreto. `postgres:audit-json` no escribe: genera un reporte JSON con hash SHA-256, recuentos, duplicados, orfandad, riesgos de fórmula de Excel y referencias Metricool contadas sin imprimir `userId` ni `blogId`.

## Migraciones incluidas

| Archivo | Propósito |
| --- | --- |
| `0001_initial_sac_flow.sql` | Crea organizaciones, usuarios, marcas, cuentas sociales, referencias Metricool cifradas, workflows, interacciones, respuestas, runs, auditoría, idempotencia y exportaciones. |
| `0002_tenant_rls.sql` | Activa Row-Level Security y políticas por `app.organization_id` para tablas tenant-scoped. |
| `0003_runtime_repository_alignment.sql` | Agrega claves runtime estables (`account_key`, `workflow_key`, `interaction_key`, `run_key`), canales por cuenta y columnas de respuesta/auditoría usadas por `PostgresRepository`. |
| `0004_multiagent_case_coordination.sql` | Persiste versión optimista, responsable y notas internas; agrega constraints y un índice operativo por asignación/estado. |
| `0005_metricool_inbox_provider.sql` | Conserva el proveedor Instagram requerido por el contrato Inbox. |
| `0006_interaction_status_reason.sql` | Persiste motivo estructurado y auditoría de cambios de estado. |
| `0007_workflow_versions_and_execution_retries.sql` | Agrega versiones/publicación, linaje de runs y `workflow_jobs` con RLS e índices de agenda/retry. |

## Tablas principales

- `organizations`, `users`, `memberships`: identidad, tenant y roles.
- `brands`, `social_accounts`: marcas y cuentas Instagram/Facebook.
- `metricool_account_refs`: referencia `userId`/`blogId` cifrada por cuenta. No almacena token global.
- `interactions`: item normalizado equivalente al contrato API.
- `replies`: borradores/envíos con idempotencia y resultado externo.
- `workflow_configs`, `workflow_nodes`, `workflow_edges`, `workflow_account_allowlist`: reglas y allowlist.
- `workflow_versions`: snapshots, actor, estado publicado/borrador/archivado y nota de cambio.
- `workflow_jobs`: agenda durable, lease, intentos, próximo retry, resultado y error seguro.
- `sync_runs`, `sync_run_items`: trazabilidad por ejecución/cuenta.
- `audit_events`: auditoría append-only para operaciones relevantes.
- `idempotency_keys`: replay seguro para mutaciones.
- `export_jobs`: control de XLSX cuando se mueva a object storage.

## Contrato tenant/RLS

Antes de cualquier query tenant-scoped, el backend productivo debe abrir transacción y fijar:

```sql
SET LOCAL app.organization_id = '<organization-uuid>';
```

Las políticas de RLS filtran por `organization_id`. No confiar en `brandId` o `accountId` enviado por el cliente sin cruzarlo con la sesión/tenant/rol del usuario.

En el adapter incluido, la organización se resuelve por `SAC_FLOW_POSTGRES_ORGANIZATION_SLUG` y las escrituras toman `pg_advisory_xact_lock` por tenant para evitar reemplazos concurrentes del estado operativo.

## Mapeo desde el JSON local

| JSON actual | PostgreSQL objetivo |
| --- | --- |
| `brands[]` | `brands.slug` + `social_accounts.account_key/channels` |
| `brand.account.metricool.userId/blogId` | `metricool_account_refs.encrypted_user_id/encrypted_blog_id` |
| `interactions[]` | `interactions.interaction_key` + columnas normalizadas |
| `interaction.responseText/respondedAt` | `interactions.response_text/responded_at/status` en el adapter actual; `replies` queda disponible para endurecimiento de envíos |
| `interaction.audit[]` | `interactions.audit_trail` en el adapter actual; `audit_events` queda disponible para auditoría append-only productiva |
| `interaction.version/assignedTo/internalNotes` | `interactions.version/assigned_to_user_id/assigned_to_display_name/internal_notes` |
| `workflow` | `workflow_configs`, `workflow_nodes`, `workflow_edges`, `workflow_account_allowlist` |
| `workflowVersions[]` | `workflow_versions` |
| `runs[]` | `sync_runs.run_key/account_keys/audit_trail`; `sync_run_items` queda disponible para trazabilidad granular por cuenta |
| `jobs[]` | `workflow_jobs` |
| `idempotency[]` | `idempotency_keys` |

## Procedimiento recomendado

1. Crear base staging vacía y rol migrador.
2. Aplicar migraciones en orden dentro del pipeline, no desde el arranque de la app.
3. Respaldar el JSON y ejecutar auditoría seca.
4. Crear una organización staging mediante `SAC_FLOW_POSTGRES_ORGANIZATION_SLUG`/`NAME`.
5. Importar JSON en transacción con `npm run postgres:import-json`.
6. Cifrar `userId`/`blogId` antes de insertar en `metricool_account_refs`; el adapter incluido lo hace con `pgcrypto`. Guardar token Metricool solo en secret manager.
7. Reconciliar recuentos por marca/cuenta/tipo/estado contra el reporte de auditoría.
8. Configurar `SAC_FLOW_REPOSITORY=postgres`, `SAC_FLOW_POSTGRES_URL`, `SAC_FLOW_POSTGRES_ENCRYPTION_KEY` y `SAC_FLOW_POSTGRES_ORGANIZATION_SLUG`.
9. Arrancar staging con el adapter incluido y ejecutar `/api/ready`.
10. Ejecutar API contra PostgreSQL en shadow read o staging.
11. Probar RLS con dos tenants y casos negativos de acceso cruzado.
12. Hacer canary con una marca en modo lectura; respuestas siguen apagadas.
13. Definir rollback: volver artefacto anterior, pausar worker y conservar DB en solo lectura para análisis.

## Herramienta incluida de auditoría/importación

Auditar el JSON local, sin escribir:

```powershell
npm run postgres:audit-json -- .\data\sac-flow.json
```

Salida esperada:

- `audit.ok=true` si no hay errores bloqueantes;
- hash SHA-256 del archivo auditado;
- recuentos de marcas, cuentas, interacciones, workflow, runs e idempotencia;
- distribución por canal, tipo, estado y sentimiento;
- duplicados por `accountId:type:externalId`;
- interacciones huérfanas o cruzadas;
- allowlist de respuestas automáticas apuntando a cuentas inexistentes;
- conteo de referencias Metricool configuradas, sin imprimir `userId`/`blogId`;
- warnings por textos con prefijo compatible con fórmulas de Excel.

Importar a PostgreSQL staging:

```powershell
$env:SAC_FLOW_POSTGRES_URL='postgres://...'
$env:SAC_FLOW_POSTGRES_ENCRYPTION_KEY='...'
$env:SAC_FLOW_POSTGRES_ORGANIZATION_SLUG='techlab-sac-staging'
$env:SAC_FLOW_POSTGRES_ORGANIZATION_NAME='Techlab SAC Staging'
npm run postgres:import-json -- .\data\sac-flow.json
```

La importación reemplaza el estado runtime del tenant configurado dentro de una transacción y con lock por organización. Si hay errores, no importa. Si hay advertencias, exige revisar el reporte o agregar `--allow-warnings`:

```powershell
npm run postgres:import-json:allow-warnings -- .\data\sac-flow.json
```

No ejecutar este comando contra producción sin backup, ventana aprobada, migraciones aplicadas y validación previa en staging. El comando no migra usuarios SSO ni secretos globales; esos deben venir del gateway/secret manager de Techlab.

## Checks mínimos post-import

```sql
SELECT count(*) FROM brands;
SELECT provider, count(*) FROM social_accounts GROUP BY provider;
SELECT provider, kind, status, count(*) FROM interactions GROUP BY provider, kind, status;
SELECT social_account_id, kind, external_id, count(*)
FROM interactions
GROUP BY social_account_id, kind, external_id
HAVING count(*) > 1;
SELECT count(*) FROM metricool_account_refs WHERE encrypted_user_id IS NULL OR encrypted_blog_id IS NULL;
```

## Pendiente antes de activar producción

- Ejecutar pruebas de contrato contra PostgreSQL real con las cinco migraciones aplicadas.
- Definir KMS/secret manager para custodiar `SAC_FLOW_POSTGRES_ENCRYPTION_KEY` y rotarlo.
- Separar rol app, rol migrador y rol read-only.
- Agregar migraciones forward-only revisadas en CI.
- Definir retención/anonimización de DMs, comentarios, auditoría y exportaciones.
