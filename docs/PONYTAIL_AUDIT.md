# Auditoría y simplificación con Ponytail

Fecha de corte: 2026-08-12.

## Fuente y alcance

La auditoría usó [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail), licencia MIT, fijado localmente en el commit `2ed6c52c9d7e5e56942508591085fd45dea277d3`. Se instalaron sus skills `ponytail`, `ponytail-audit`, `ponytail-review`, `ponytail-debt`, `ponytail-gain` y `ponytail-help` en el entorno local de Codex. El checkout de investigación no se modificó.

El alcance fue el frontend, API, motor, repositorios, worker, pruebas y documentación de Flow Studio. La auditoría no hizo push, publicación, despliegue ni llamadas o mutaciones a Metricool.

## Hallazgos Ponytail aplicados

Cada hallazgo responde la pregunta de Ponytail: ¿qué se puede borrar, aplanar o reemplazar por una primitiva estándar sin perder comportamiento real?

- `src/data/demo.ts:1`: borrar la segunda fuente de verdad ficticia de 879 líneas; las vistas ahora dependen de la API y fallan de forma visible si no está disponible. Riesgo: bajo; cubierto por build y E2E.
- `src/lib/api.ts:1`: borrar fallback y éxitos simulados del cliente; el modo demo sigue siendo un modo explícito del servidor, no una fabricación silenciosa del navegador. Riesgo: medio; cubierto por pruebas API/E2E.
- `src/components/WorkflowCanvas.tsx:1`: borrar progreso y estados de nodos inventados por temporizadores; una ejecución solo muestra estado respaldado por el servidor. Riesgo: bajo; cubierto por E2E visual.
- `src/App.tsx:1`: borrar estado local falso del switch SAC y derivarlo de `workflow.enabled`; las mutaciones pasan por la API real. Riesgo: medio; cubierto por typecheck/build/E2E.
- `server/automation-catalog.ts:1`: borrar `core.loop` y OAuth2 anunciados sin implementación; el motor ya procesa items de forma nativa y solo publica cinco credenciales realmente soportadas. Riesgo: bajo; catálogo y validación tienen pruebas.
- `server/metricool-client.ts:1`: reemplazar timeout manual por `AbortSignal.timeout`; menos estados y cleanup propios. Riesgo: bajo; suite servidor verde.
- `server/worker.ts:1`: reemplazar timers manuales por `node:timers/promises`; se conserva cancelación por señal. Riesgo: bajo; typecheck y pruebas del worker verdes.
- `server/index.ts:1`: borrar dependencia `dotenv` y usar `process.loadEnvFile()` de Node 22 mediante `server/load-env.ts`. Riesgo: bajo; build API verde y requisito Node 22 documentado.
- `src/styles.css:1`: borrar reglas, keyframes y media queries duplicadas; se mantuvo un solo sistema visual azul verificado a 1600×900. Riesgo: medio; capturas y auditoría de color sin tonos naranjas.
- `server/*`, `src/*`: borrar exports, tipos, imports y parámetros sin consumidores detectados por TypeScript estricto y Knip. Riesgo: bajo; ambos análisis quedaron limpios.

Resultado medido en el alcance de la auditoría: **868 líneas netas menos** y **una dependencia directa menos**, pese a conservar las capacidades del overhaul. La eliminación individual más grande fue `src/data/demo.ts` con 879 líneas.

## Correcciones de calidad y seguridad encontradas durante la revisión

- El trigger ejecutado queda aislado por `triggerNodeId`; nodos y conexiones deshabilitados no se recorren.
- Los formularios URL-encoded y la respuesta configurada del webhook funcionan con el contrato publicado.
- Timezone IANA, rangos de timeout/concurrencia, nombres, tipos, versiones, opciones, ciclos y conflictos globales de rutas se validan antes de publicar.
- Workflows archivados no pueden editarse, publicarse ni activarse; carpetas, proyectos, tags, credenciales y variables aplican validaciones de integridad.
- El límite de concurrencia se reclama dentro de una mutación transaccional y recupera ejecuciones stale.
- Las reservas idempotentes son atómicas en JSON/PostgreSQL; un duplicado concurrente recibe `IDEMPOTENCY_IN_PROGRESS` y la respuesta final se reproduce sin crear una segunda ejecución.
- Los valores de credenciales y variables secretas se redactan antes de persistir inputs, outputs y node runs.
- El nodo HTTP rechaza userinfo, direcciones privadas/reservadas y redirecciones, limita la respuesta a 100 kB y aplica timeout.
- PostgreSQL lee y actualiza el documento de Automation Studio sin ejecutar el reemplazo destructivo del store SAC completo.
- El workflow de error se despacha después de persistir el resultado original y tiene guard de profundidad/recursión.

## Debt ledger

Queda un marcador Ponytail deliberado:

- `server/automation-engine.ts:186` — **trigger:** habilitar nodos HTTP en staging/producción; **deuda:** la validación DNS previa no elimina carreras de DNS rebinding; **salida:** proxy/firewall de egreso con política de destinos y prueba AppSec.

Marcadores sin trigger o plan de eliminación: **0**.

## Evidencia reproducible

```powershell
npm run check
npm run build:all
npm test
npm run test:e2e
npm run security:audit
npx --yes knip@5.80.0 --include "dependencies,exports,types" --reporter compact --no-exit-code
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
```

Además, Playwright recorre las vistas principales y rechaza controles interactivos sin nombre accesible. La revisión manual del editor comprobó consola limpia y ausencia de tonos naranjas renderizados.

## Límites externos no resueltos por código local

- El smoke de Docker queda bloqueado hasta que Windows complete el reinicio requerido por WSL/Virtual Machine Platform.
- Falta ejecutar migraciones, RLS, concurrencia e idempotencia contra PostgreSQL real.
- Falta SSO/OIDC, secret manager, observabilidad, backups/restore, carga/caos y pentest en la infraestructura final.
- Falta UAT autorizada con cuentas Metricool reales; los flags de salidas y mutaciones permanecen bloqueados.

Por estas fronteras, el estado verificable es **beta general funcional y endurecida localmente**, no paridad total con n8n ni aprobación productiva.
