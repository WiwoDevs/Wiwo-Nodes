/**
 * Clasifica interacciones entrantes con Claude y escribe el resultado en el repositorio.
 *
 * Rellena `category` y `sentiment` —que el motor de reglas respeta cuando ya vienen
 * decididos— y agrega `sacTriage` con las dos distinciones que las reglas no pueden hacer:
 * si el mensaje es un caso de atención y si responderlo exige información interna.
 *
 * Es reanudable: por defecto salta lo ya clasificado, así que una corrida interrumpida se
 * retoma sin repetir gasto.
 *
 * Uso:
 *   node scripts/classify-interactions.mjs --mes 2026-08 [--concurrencia 4] [--lote 40] [--rehacer]
 */
import { loadConfig } from "../dist-api/config.js";
import { loadLocalEnvironment } from "../dist-api/load-env.js";
import { createRepository } from "../dist-api/repository-factory.js";
import { classifyInteractions } from "../dist-api/ai-classifier.js";

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : porDefecto;
}
const mes = arg("mes", null);
const concurrencia = Math.max(1, Math.min(Number(arg("concurrencia", 4)) || 4, 8));
const lote = Math.max(1, Math.min(Number(arg("lote", 40)) || 40, 50));
const rehacer = process.argv.includes("--rehacer");

loadLocalEnvironment();
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Falta ANTHROPIC_API_KEY en el entorno.");
  process.exit(1);
}

const config = loadConfig();
const repository = createRepository(config);
await repository.initialize();

const store = await repository.snapshot();
const activas = new Set(store.brands.filter((b) => b.active && b.account.active).map((b) => b.id));
const pendientes = store.interactions.filter((i) =>
  activas.has(i.brandId)
  && i.direction === "inbound"
  && (!mes || i.createdAt.slice(0, 7) === mes)
  && (rehacer || !i.sacTriage));

console.log(`a clasificar: ${pendientes.length} mensajes${mes ? ` de ${mes}` : ""}`);
if (!pendientes.length) {
  await repository.close?.();
  process.exit(0);
}

const lotes = [];
for (let i = 0; i < pendientes.length; i += lote) lotes.push(pendientes.slice(i, i + lote));
console.log(`lotes: ${lotes.length} de hasta ${lote} | concurrencia: ${concurrencia}\n`);

const modelo = "claude-opus-5";
const resultados = new Map();
let hechos = 0;
let fallidos = 0;
const inicio = Date.now();

// Ventana deslizante: mantiene N lotes en vuelo sin cargar todo en memoria a la vez.
let siguiente = 0;
async function trabajador() {
  while (siguiente < lotes.length) {
    const indice = siguiente++;
    try {
      const salida = await classifyInteractions(lotes[indice], { batchSize: lote, model: modelo });
      for (const r of salida) resultados.set(r.id, r);
      hechos += 1;
    } catch (error) {
      fallidos += 1;
      console.log(`  lote ${indice + 1} falló: ${error.message}`);
    }
    const transcurrido = (Date.now() - inicio) / 1000;
    const ritmo = (hechos + fallidos) / transcurrido;
    const restantes = lotes.length - hechos - fallidos;
    process.stdout.write(
      `\r  ${hechos + fallidos}/${lotes.length} lotes · ${resultados.size} clasificados`
      + ` · ~${Math.round(restantes / (ritmo || 1))}s restantes    `,
    );
  }
}
await Promise.all(Array.from({ length: concurrencia }, () => trabajador()));
console.log(`\n\nclasificados: ${resultados.size} | lotes fallidos: ${fallidos}`);

if (resultados.size) {
  const clasificadoEn = new Date().toISOString();
  let escritas = 0;
  await repository.mutateInteractions([...resultados.keys()], (store) => {
    for (const interaction of store.interactions) {
      const r = resultados.get(interaction.id);
      if (!r) continue;
      escritas += 1;
      // `category` y `sentiment` son los campos canónicos: el motor de reglas los respeta
      // cuando ya vienen decididos, así que la IA no compite con los guardrails.
      interaction.category = r.categoria;
      interaction.sentiment = r.tonalidad;
      interaction.confidence = r.confianza;
      interaction.sacTriage = {
        categoria: r.categoria,
        esCasoSac: r.esCasoSac,
        requiereDerivacion: r.requiereDerivacion,
        confianza: r.confianza,
        clasificadoEn,
        modelo,
      };
    }
    return escritas;
  });
  console.log(`guardadas ${escritas} interacciones en el repositorio.`);
}

await repository.close?.();
