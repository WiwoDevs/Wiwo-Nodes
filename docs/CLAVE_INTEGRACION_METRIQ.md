# Conectar MetriQ con wiwo.sac: clave de integración

wiwo.sac ya tiene una API para que MetriQ lea los datos SAC: casos por marca, totales mensuales, cifras del reporte y el Excel del mes. Está publicada en producción, pero **queda cerrada hasta configurar una clave compartida** en los dos servidores.

- **Es de solo lectura.** Solo acepta `GET` en `https://sac.wiwo.me/api/integrations/*`, y la clave no abre ninguna otra ruta de wiwo.sac.
- **La usa solo el servidor de MetriQ.** Nunca va al navegador.

## 1. Generar la clave (una sola vez)

```bash
openssl rand -hex 32
```

Da 64 caracteres. Compártanla solo por un canal seguro, como un gestor de contraseñas. **No la pongan en chats, correos, tickets ni repositorios.**

## 2. Servidor de wiwo.sac

En la carpeta del despliegue de wiwo.sac (la de `docker-compose.production.yml`):

1. Agregar a `.env.production`:
   ```
   SAC_FLOW_SERVICE_API_KEY=<clave>
   ```
2. Reiniciar la API:
   ```bash
   docker compose --env-file .env.production -f docker-compose.production.yml up -d api
   ```
3. Comprobar. Este comando debe responder `200`; sin la clave, la respuesta es `401`:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(grep '^SAC_FLOW_SERVICE_API_KEY=' .env.production | cut -d= -f2 | cut -d, -f1)" https://sac.wiwo.me/api/integrations/sac-brands
   ```

Cuidados:
- **La clave debe tener 32 caracteres o más.** Si es más corta, la API no arranca.
- **No es la misma variable que `SAC_FLOW_API_KEY`**, que ya existe y la usan los procesos internos de wiwo.sac. No la reutilicen.
- Sin comillas ni espacios. La coma separa claves (se usa al rotar).

## 3. VPS de MetriQ

En el archivo de entorno del servidor de MetriQ, donde ya están sus otras claves de servidor (`METRICOOL_USER_TOKEN`, `META_ACCESS_TOKEN`…):

```
NODES_API_URL=https://sac.wiwo.me
NODES_SERVICE_API_KEY=<la misma clave>
```

Después, reiniciar o volver a desplegar MetriQ.

- **Nunca con el prefijo `NEXT_PUBLIC_`**, porque la expondría al navegador.
- MetriQ empezará a usar estas variables cuando se incorpore el código de la integración. Mientras tanto no tienen efecto.

Para verificar que el VPS de MetriQ llega a wiwo.sac, el mismo `curl` del paso 2.3, pero con la clave de MetriQ, también debe dar `200`.

## Rotar la clave sin cortes

1. En wiwo.sac: `SAC_FLOW_SERVICE_API_KEY=<vieja>,<nueva>` y reiniciar la API.
2. En MetriQ: cambiar a la nueva y reiniciar.
3. En wiwo.sac: dejar solo la nueva y reiniciar la API.

---
El contrato completo de la API está en `docs/INTEGRACION_METRIQ.md`, en el repositorio de wiwo.sac.
