/**
 * Clasifica con IA, en modo sombra, los mensajes entrantes de un mes (o de los últimos días).
 *
 * Usa el proveedor configurado (SAC_FLOW_AI_PROVIDER, por defecto DeepSeek vía BytePlus
 * ModelArk) y solo las marcas autorizadas en SAC_FLOW_AI_BRAND_IDS. Escribe `aiTriage`: no toca
 * `sacTriage`, la categoría, el tono, el estado ni la versión de los casos, y nunca pasa por
 * encima de una marca manual. Los textos se enmascaran antes de salir (correo, teléfono, RUT,
 * usuario, enlaces, tarjetas).
 *
 * Es reanudable: salta lo que la IA ya clasificó, así que una corrida interrumpida se retoma
 * sin repetir gasto. La concordancia se lee en GET /api/ai/agreement?month=AAAA-MM.
 *
 * Uso:
 *   node scripts/classify-interactions.mjs --mes 2026-08 [--maximo 2000] [--concurrencia 2] [--lote 20]
 */
import { loadConfig } from "../dist-api/config.js";
import { loadLocalEnvironment } from "../dist-api/load-env.js";
import { createRepository } from "../dist-api/repository-factory.js";
import { createAiProvider } from "../dist-api/ai-provider.js";
import { runShadowTriage } from "../dist-api/ai-shadow-triage.js";
import { monthPeriod } from "../dist-api/sac-report.js";

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : porDefecto;
}

loadLocalEnvironment();
const config = loadConfig();
const estado = createAiProvider(config.ai);
if (!estado.ready) {
  console.error(estado.reason === "disabled"
    ? "La IA está apagada: defina SAC_FLOW_AI_ENABLED=true."
    : `Falta la clave del proveedor ${config.ai.provider} (${config.ai.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "BYTEPLUS_API_KEY"}).`);
  process.exit(1);
}
if (config.ai.brandIds !== "all" && !config.ai.brandIds.length) {
  console.error("Ninguna marca autorizada: defina SAC_FLOW_AI_BRAND_IDS (ids separados por comas, o * para todas).");
  process.exit(1);
}

const mes = arg("mes", null);
if (mes && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
  console.error("Use --mes AAAA-MM.");
  process.exit(1);
}
const periodo = mes ? monthPeriod(mes) : undefined;
const maximo = Math.max(1, Math.min(Number(arg("maximo", 2_000)) || 2_000, 50_000));
const concurrencia = Math.max(1, Math.min(Number(arg("concurrencia", 2)) || 2, 8));
const lote = Math.max(1, Math.min(Number(arg("lote", config.ai.batchSize)) || config.ai.batchSize, 50));

const repository = createRepository(config);
await repository.initialize();

console.log(`proveedor: ${estado.provider.name} · modelo: ${estado.provider.model}`
  + ` · ${periodo ? `mes ${periodo.label}` : `últimos ${config.ai.lookbackDays} días`}`
  + ` · máximo ${maximo} · lotes de ${lote} · concurrencia ${concurrencia}`);

const inicio = Date.now();
const resultado = await runShadowTriage(repository, {
  provider: estado.provider,
  brandIds: config.ai.brandIds,
  batchSize: lote,
  maxPerRun: maximo,
  concurrency: concurrencia,
  ...(periodo
    ? { from: `${periodo.from}T00:00:00.000Z`, to: `${periodo.to}T23:59:59.999Z` }
    : { lookbackDays: config.ai.lookbackDays }),
});

console.log(`candidatos: ${resultado.candidates} | clasificados: ${resultado.classified}`
  + ` | sensibles: ${resultado.sensitive} | lotes fallidos: ${resultado.failedBatches}`
  + ` | tokens: ${resultado.usage.inputTokens} entrada, ${resultado.usage.outputTokens} salida`
  + ` | ${Math.round((Date.now() - inicio) / 1000)} s`);
if (resultado.firstError) console.log(`primer error: ${resultado.firstError}`);

await repository.close?.();
