/**
 * Importa las conversaciones privadas de Facebook a ritmo lento.
 *
 * El sync masivo las pierde: Metricool devuelve `200` con lista vacía para
 * `/v2/inbox/conversations?provider=FACEBOOK` cuando recibe muchas solicitudes seguidas,
 * y esa respuesta es indistinguible de "esta marca no tiene mensajes". Los comentarios de
 * Facebook y todo Instagram sí llegan en la misma corrida, así que el problema es puntual
 * de ese endpoint bajo presión.
 *
 * Este importador recorre una marca cada varios segundos y reutiliza el mismo normalizador
 * y el mismo repositorio que el sync, de modo que la deduplicación por `externalId` sigue
 * siendo la autoridad: correrlo dos veces no duplica nada.
 *
 * Uso:  node scripts/import-facebook-dms.mjs [--espera 4]
 */
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig, resolveMetricoolAccount } from "../dist-api/config.js";
import { loadLocalEnvironment } from "../dist-api/load-env.js";
import { MetricoolClient } from "../dist-api/metricool-client.js";
import { createRepository } from "../dist-api/repository-factory.js";
import { normalizeMetricoolConversations } from "../dist-api/workflow-service.js";

const args = process.argv.slice(2);
const esperaIndex = args.indexOf("--espera");
const esperaSegundos = esperaIndex >= 0 ? Number(args[esperaIndex + 1]) || 4 : 4;

loadLocalEnvironment();
const config = loadConfig();
if (config.demoMode || !config.metricool.token) {
  console.error("Se requiere METRICOOL_MODE=live con token configurado.");
  process.exit(1);
}

const repository = createRepository(config);
await repository.initialize();
const client = new MetricoolClient({ token: config.metricool.token, baseUrl: config.metricool.baseUrl });

const store = await repository.snapshot();
const marcas = store.brands.filter((brand) =>
  brand.active
  && brand.account.active
  && brand.account.channels.includes("facebook"));

console.log(`marcas con Facebook: ${marcas.length} | espera entre marcas: ${esperaSegundos}s\n`);

let leidas = 0;
let creadas = 0;
let vacias = 0;

for (const brand of marcas) {
  const account = resolveMetricoolAccount(config, brand.account.id, brand.account.metricool);
  if (!account) {
    console.log(`  ${brand.name.padEnd(26)} sin referencia Metricool`);
    continue;
  }

  let payload;
  try {
    payload = await client.listConversations(account, "FACEBOOK");
  } catch (error) {
    console.log(`  ${brand.name.padEnd(26)} error: ${error.message}`);
    await delay(esperaSegundos * 1000);
    continue;
  }

  const conversaciones = Array.isArray(payload?.data) ? payload.data.length : 0;
  const normalizadas = normalizeMetricoolConversations(payload, brand, "FACEBOOK");
  const { created, duplicates } = await repository.insertInteractions(normalizadas);

  leidas += conversaciones;
  creadas += created.length;
  // Una marca con cero conversaciones puede ser real o puede ser la respuesta vacía bajo
  // presión: se reporta aparte para que el operador decida si vale reintentar.
  if (conversaciones === 0) vacias += 1;

  console.log(
    `  ${brand.name.padEnd(26)} conversaciones=${String(conversaciones).padStart(3)}`
    + ` → normalizadas=${String(normalizadas.length).padStart(4)}`
    + ` nuevas=${String(created.length).padStart(4)} duplicadas=${String(duplicates).padStart(4)}`,
  );

  await delay(esperaSegundos * 1000);
}

console.log(`\nconversaciones leídas: ${leidas} | interacciones nuevas: ${creadas}`);
if (vacias) {
  console.log(`marcas que devolvieron vacío: ${vacias} — reintente con --espera mayor si esperaba datos.`);
}

await repository.close?.();
