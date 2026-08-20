# Wiwo.Nodes — handoff técnico

Este paquete contiene el código fuente y la configuración reproducible de Wiwo.Nodes / SAC Flow. No incluye credenciales, conversaciones, archivos de carga, base de datos local ni dependencias instaladas.

## Arranque local

1. Copia `.env.example` a `.env` y completa las variables de tu entorno. No subas ese archivo a control de versiones.
2. Instala Docker Desktop.
3. Ejecuta `docker compose --env-file .env -f docker-compose.production.yml up -d --build`.
4. Abre `http://127.0.0.1:8787` y comprueba `http://127.0.0.1:8787/api/ready`.

Para desarrollo sin Docker: `npm ci`, luego `npm run check` y los comandos descritos en `package.json`.

## Estado de operación incluido

- El inbox sincroniza lecturas de Metricool cada 5 minutos como mínimo y serializa solicitudes por token. Ante `429`, respeta `Retry-After`.
- La actualización de bandeja en el navegador es de solo lectura y no despacha respuestas automáticas.
- Los envíos manuales, automatizaciones y cualquier integración remota quedan gobernados por las variables de `.env`; revísalas antes de habilitarlas.
- Agent Reach se usó únicamente para investigación durante el desarrollo; no forma parte de las dependencias ni del runtime.

## Material de referencia

- `README.md`: puesta en marcha y arquitectura general.
- `docs/METRICOOL_SETUP.md`: integración y consumo responsable de Metricool.
- `docs/OPERATIONS_RUNBOOK.md`: operación y diagnóstico.
- `docs/API_CONTRACT.md`: contrato HTTP.
- `docs/PROFESSIONAL_COMPLETION_CHECKLIST.md`: tareas pendientes para producción amplia.

## Validación recomendada antes de continuar

```powershell
npm run check
npm test
npm run build:all
docker compose --env-file .env -f docker-compose.production.yml up -d --build
```

No reutilices ni inventes credenciales incluidas fuera de tu propio gestor de secretos. Para una instalación nueva, configura la clave de acceso de la aplicación y las credenciales de Metricool exclusivamente en `.env` o en un gestor de secretos.
