/**
 * Backfill lento del inbox, superficie por superficie.
 *
 * El sync masivo dispara las superficies de cada canal en paralelo y Metricool responde
 * `200` con lista vacía cuando recibe muchas solicitudes seguidas. Esa respuesta es
 * indistinguible de "esta marca no tiene nada", así que el sync deja huecos silenciosos:
 * los mensajes privados de Facebook fueron el primero, los comentarios de LinkedIn de
 * COLBÚN y los de Instagram de Converse aparecieron después.
 *
 * Este importador recorre una superficie a la vez con varios segundos de separación y
 * reutiliza los normalizadores y el repositorio del sync, de modo que la deduplicación por
 * `externalId` sigue siendo la autoridad: correrlo dos veces no duplica nada.
 *
 * Uso:  node scripts/backfill-inbox.mjs [--espera 4] [--marca "Converse"]
 */
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig, resolveMetricoolAccount } from "../dist-api/config.js";
import { loadLocalEnvironment } from "../dist-api/load-env.js";
import { MetricoolClient } from "../dist-api/metricool-client.js";
import { createRepository } from "../dist-api/repository-factory.js";
import {
  normalizeMetricoolComments,
  normalizeMetricoolConversations,
  normalizeMetricoolReviews,
} from "../dist-api/workflow-service.js";
import {
  metricoolInboxSurfacesForChannel,
  metricoolProviderForSurface,
} from "../dist-api/types.js";

const args = process.argv.slice(2);
const valor = (bandera, porDefecto) => {
  const i = args.indexOf(bandera);
  return i >= 0 ? args[i + 1] : porDefecto;
};
const espera = Number(valor("--espera", 4)) * 1000;
const soloMarca = valor("--marca", undefined);

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
const marcas = store.brands
  .filter((brand) => brand.active && brand.account.active)
  .filter((brand) => !soloMarca || brand.name === soloMarca)
  .sort((a, b) => a.name.localeCompare(b.name));

let leidas = 0;
let creadas = 0;
const huecos = [];

for (const brand of marcas) {
  const account = resolveMetricoolAccount(config, brand.account.id, brand.account.metricool);
  if (!account) {
    console.log(`  ${brand.name.padEnd(20)} sin referencia Metricool`);
    continue;
  }

  for (const channel of brand.account.channels) {
    for (const surface of metricoolInboxSurfacesForChannel(channel)) {
      const provider = metricoolProviderForSurface(channel, surface, account);
      let payload;
      try {
        payload = surface === "conversations"
          ? await client.listConversations(account, provider)
          : surface === "comments"
            ? await client.listPostComments(account, provider)
            : await client.listReviews(account, provider);
      } catch (error) {
        console.log(`  ${brand.name.padEnd(20)} ${channel}/${surface.padEnd(14)} error: ${String(error.message).slice(0, 60)}`);
        await delay(espera);
        continue;
      }

      const normalizadas = surface === "conversations"
        ? normalizeMetricoolConversations(payload, brand, provider)
        : surface === "comments"
          ? normalizeMetricoolComments(payload, brand, provider)
          : normalizeMetricoolReviews(payload, brand, provider);

      const resultado = normalizadas.length
        ? await repository.insertInteractions(normalizadas)
        : { created: [], duplicates: 0 };

      leidas += normalizadas.length;
      creadas += resultado.created.length;
      if (resultado.created.length) {
        huecos.push({ marca: brand.name, canal: `${channel}/${surface}`, nuevas: resultado.created.length });
      }
      console.log(
        `  ${brand.name.padEnd(20)} ${(channel + "/" + surface).padEnd(24)}`
        + `leídas ${String(normalizadas.length).padStart(4)}  nuevas ${String(resultado.created.length).padStart(4)}`,
      );
      await delay(espera);
    }
  }
}

console.log(`\nleídas ${leidas} · nuevas ${creadas}`);
if (huecos.length) {
  console.log("\nsuperficies que aportaron interacciones nuevas:");
  for (const h of huecos.sort((a, b) => b.nuevas - a.nuevas)) {
    console.log(`  ${h.marca.padEnd(20)} ${h.canal.padEnd(24)} ${h.nuevas}`);
  }
}
