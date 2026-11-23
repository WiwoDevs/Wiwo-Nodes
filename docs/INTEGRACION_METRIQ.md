# Integración wiwo.sac → MetriQ (SAC)

MetriQ (`WiwoDevs/WiwoMetrics`) arma el módulo SAC (dashboard, informes, Excel y presentaciones) a partir de **filas SAC**, que hoy lee de una planilla de Google Sheets por marca y año ("BD SAC <marca> <año>"). wiwo.sac ya tiene esos mismos datos, sincronizados desde Metricool. Esta API de solo lectura los entrega con **el mismo formato de fila** que usa MetriQ (`lib/sac/types.ts → SacRow`), así que MetriQ solo cambia de dónde lee, no cómo los usa.

## Conexión

- **Base:** `https://sac.wiwo.me`
- **Autenticación:** `Authorization: Bearer <clave>` (o `X-API-Key: <clave>`). La clave es `SAC_FLOW_SERVICE_API_KEY` en el servidor de wiwo.sac, de 32 caracteres o más.
- **Solo desde el servidor de MetriQ** (route handlers de Next.js, con la clave en las variables de entorno del VPS donde corre MetriQ). Nunca desde el navegador: wiwo.sac no habilita CORS para estas rutas y la clave no debe llegar al cliente.
- **Solo lectura:** cualquier método distinto de `GET` responde `405`. La clave no abre ninguna otra ruta de wiwo.sac.
- **Sin clave o con una incorrecta:** `401 SERVICE_KEY_REQUIRED`. Si wiwo.sac no tiene clave configurada, todas las rutas responden `401`.

### Rotar la clave sin cortes

`SAC_FLOW_SERVICE_API_KEY` acepta varias claves separadas por comas:

1. En wiwo.sac, agregar la nueva: `SAC_FLOW_SERVICE_API_KEY=<vieja>,<nueva>`, y reiniciar.
2. En MetriQ, cambiar a la nueva y desplegar.
3. En wiwo.sac, dejar solo la nueva.

Las claves no se escriben en archivos versionados, tickets ni chats.

## Qué significan los datos

- **Una fila es un caso SAC**, igual que en las planillas que llenaba el equipo. El ruido social (reacciones, menciones en historias, emojis sueltos y textos de menos de cuatro palabras) no se entrega, salvo que se pida con `incluirRuido=true`; la respuesta informa cuántos se descontaron. Lo que una persona marcó a mano en wiwo.sac ("Es caso" / "No es caso") manda sobre las reglas.
- **Estados** con los nombres que reconoce el dashboard de MetriQ:

  | wiwo.sac | Fila |
  |---|---|
  | nuevo, pendiente | `Pendiente` |
  | borrador | `En proceso` |
  | respondido por el equipo, resuelto | `Resuelto` |
  | escalado | `Derivado` |

- **Categoría:** etiqueta legible ("Reclamos", "Despachos", "Precios"…), las mismas del reporte de wiwo.sac.
- **Fechas y meses en días UTC**, igual que el reporte mensual de wiwo.sac.
- **Desde cuándo hay datos:** wiwo.sac solo tiene lo que sincronizó desde que se conectó cada marca (`datosDesde` en `sac-brands`). Para los meses anteriores, MetriQ debe seguir leyendo la planilla.
- **TikTok y LinkedIn cargados a mano:** Metricool trae sus comentarios, pero no sus DMs ni lo que el equipo registra en la planilla. Para eso, el equipo sube en wiwo.sac (Reportes → Cargar TikTok/LinkedIn) el Excel BD SAC, y esos casos llegan por estas mismas rutas como filas con `plataforma` "TikTok" o "LinkedIn", con el estado y la tonalidad de la planilla. MetriQ no necesita hacer nada distinto para leerlos.
- **Clientes ocultos:** un admin principal puede ocultar en wiwo.sac los clientes que no se reportan. Un cliente oculto no aparece en `sac-brands` ni en los totales y reportes de todas las marcas, y pedirlo por `brandId` responde `409 BRAND_INACTIVE`. Si vuelve a mostrarse, reaparece con todo su historial.
- **Frescura:** las respuestas traen `meta.lastSyncAt` y `meta.lastSyncStatus` (última sincronización con Metricool) y `meta.generatedAt`.

## Rutas

### `GET /api/integrations/sac-brands`

Marcas activas en wiwo.sac, para configurar en MetriQ qué marca de MetriQ corresponde a cuál de wiwo.sac (los nombres no siempre coinciden: "Vans" en MetriQ puede ser "Vans Colombia" en wiwo.sac).

```json
{
  "data": [
    { "brandKey": "vans-colombia", "brandLabel": "Vans Colombia", "handle": "@vanscolombia",
      "channels": ["instagram", "facebook"], "interactions": 1234,
      "datosDesde": "2026-08-01", "datosHasta": "2026-11-17" }
  ],
  "meta": { "count": 46, "generatedAt": "…", "lastSyncAt": "…", "lastSyncStatus": "success" }
}
```

### `GET /api/integrations/sac-rows?brandId=<brandKey>&from=YYYY-MM-DD&to=YYYY-MM-DD[&incluirRuido=true]`

Filas SAC de una marca (reemplaza la lectura de la planilla). `from` y `to` son opcionales e inclusivos. Ordenadas de la más reciente a la más antigua.

```json
{
  "data": {
    "brandKey": "vans-colombia",
    "brandLabel": "Vans Colombia",
    "rows": [
      { "brandKey": "vans-colombia", "brandLabel": "Vans Colombia", "fechaComentario": "2026-10-14",
        "plataforma": "Instagram", "canal": "@vanscolombia", "usuario": "Nombre (@usuario)",
        "reclamo": "Texto del mensaje", "categoria": "Despachos", "tonalidad": "Negativa",
        "estado": "Resuelto", "observacion": "Respondido el 2026-10-14", "mes": "Octubre" }
    ]
  },
  "meta": { "count": 215, "droppedNoDate": 0, "droppedNoise": 287, "incluirRuido": false,
            "from": "2026-10-01", "to": "2026-10-31", "generatedAt": "…", "lastSyncAt": "…", "lastSyncStatus": "success" }
}
```

Contiene datos de clientes (usuario y texto): tratarlos igual que hoy se tratan las planillas.

### `GET /api/integrations/sac-totals?from=YYYY-MM&to=YYYY-MM[&brandId=<brandKey>]`

Totales por mes (reemplaza la pestaña "Total interacciones"). Máximo 24 meses por consulta; sin `brandId`, todas las marcas activas.

```json
{
  "data": [
    { "brandKey": "vans-colombia", "brandLabel": "Vans Colombia",
      "months": [
        { "monthKey": "2026-10", "label": "Octubre 2026", "recibidos": 502, "casosSac": 215,
          "ruido": 287, "respondidos": 26, "coberturaPct": 12.1, "derivados": 0 }
      ] }
  ],
  "meta": { "from": "2026-10", "to": "2026-10", "count": 1, "generatedAt": "…", "lastSyncAt": "…" }
}
```

### `GET /api/integrations/sac-report?month=YYYY-MM[&brandId=<brandKey>][&volumen=gestionado|bruto]`

Las mismas cifras que la sección **Reportes** de wiwo.sac, por marca: casos SAC, recibidos, gestionados, ilegibles, derivados, respondidos, cobertura, canales, privados y públicos, motivos, tono, variación contra el mes anterior (con `comparable` y `revisar`), avisos y origen de la clasificación (`clasificacion: { manual, ia, reglas }`). Solo cifras agregadas, sin mensajes ni datos de clientes. `data.warnings` avisa de cuentas duplicadas.

### `GET /api/integrations/sac-export?month=YYYY-MM[&brandId=<brandKey>]`

El Excel del mes (mismo archivo que se descarga desde Reportes), de una marca o de todas. Responde `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` con `Content-Disposition: attachment; filename="sac-<marca|todas>-<mes>.xlsx"`.

### Errores

| Código | Cuándo |
|---|---|
| `400 VALIDATION_ERROR` | Fecha o mes con formato inválido, rango invertido o de más de 24 meses |
| `401 SERVICE_KEY_REQUIRED` | Sin clave, clave incorrecta o wiwo.sac sin clave configurada |
| `404 BRAND_NOT_FOUND` | El `brandId` no existe en wiwo.sac |
| `405 METHOD_NOT_ALLOWED` | Método distinto de `GET` |
| `409 BRAND_INACTIVE` | La marca está desactivada en wiwo.sac |
| `429` | Límite de solicitudes (600 por minuto por IP) |

## Cómo conectarlo en MetriQ (propuesta)

1. **Fuente por marca:** en "Configurar fuentes", cada marca elige *Planilla* o *wiwo.sac*. Si es wiwo.sac, se elige su `brandKey` de la lista de `sac-brands` y desde qué mes usarla (por defecto `datosDesde`). Se guarda en el overlay de Firestore (`sac_sources/{key}`) junto a lo que ya existe.
2. **Lectura:** en `loadSacRows`, las marcas con fuente wiwo.sac piden `sac-rows` con el período solicitado; los meses anteriores a su inicio se siguen leyendo de la planilla. Mantener la caché corta de 60 s y el manejo de errores por marca (`errors` sin cortar el resto).
3. **Totales:** donde hoy se lee "Total interacciones", usar `sac-totals`.
4. **Frescura:** mostrar `lastSyncAt` ("datos al …") y advertir si `lastSyncStatus` es `failed` o si tiene más de 24 horas.
5. **Variables en el VPS de MetriQ** (MetriQ ya no se despliega en Vercel: un push a `main` lo despliega por SSH en su propio VPS): `NODES_API_URL=https://sac.wiwo.me` y `NODES_SERVICE_API_KEY=<clave>`, en el mismo archivo de entorno donde están sus otras claves de servidor (`METRICOOL_USER_TOKEN`, `META_ACCESS_TOKEN`…), y volver a desplegar o reiniciar MetriQ. Solo servidor, nunca `NEXT_PUBLIC_`.
