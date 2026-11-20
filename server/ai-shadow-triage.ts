/**
 * Clasificación de IA en modo sombra.
 *
 * Toma los mensajes entrantes recientes que nadie marcó a mano y que la IA todavía no vio,
 * de las marcas autorizadas a enviar datos al proveedor, y guarda el resultado en
 * `aiTriage`. No toca `sacTriage`, `category`, `sentiment`, `confidence`, el estado ni la
 * versión del caso: los Reportes y la bandeja siguen igual. La única señal que actúa es
 * `sensible`, que la política de seguridad usa para exigir revisión humana.
 *
 * Lo usan el worker (cada `SAC_FLOW_AI_INTERVAL_SECONDS`) y `scripts/classify-interactions.mjs`.
 */
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import {
  CLASSIFIER_PROMPT_VERSION,
  classifyInteractions,
  type ClassificationOutcome,
} from "./ai-classifier.js";
import type { AiProvider, AiUsage } from "./ai-provider.js";
import { isMetricoolContentUnavailable } from "./metricool-content.js";
import type { SacFlowRepository } from "./repository-contract.js";
import { esTriajeManual } from "./sac-report.js";
import type { AiTriage, Brand, Interaction } from "./types.js";

export interface ShadowTriageOptions {
  provider: AiProvider;
  brandIds: AppConfig["ai"]["brandIds"];
  batchSize: number;
  maxPerRun: number;
  /** Desde cuándo mirar (ISO). Por defecto, `lookbackDays` hacia atrás. */
  from?: string;
  to?: string;
  lookbackDays?: number;
  /** Lotes en vuelo a la vez; el worker usa 1 para no competir con la sincronización. */
  concurrency?: number;
  now?: Date;
}

export interface ShadowTriageResult {
  candidates: number;
  classified: number;
  sensitive: number;
  failedBatches: number;
  /** Primer error de lote, sin texto de clientes. */
  firstError?: string;
  usage: AiUsage;
}

function brandAllowed(brand: Brand, allowed: AppConfig["ai"]["brandIds"]): boolean {
  if (!brand.active || !brand.account.active) return false;
  return allowed === "all" || allowed.includes(brand.id);
}

/** Si un mensaje entra a la clasificación en sombra. */
export function needsShadowTriage(interaction: Interaction): boolean {
  return interaction.direction === "inbound"
    && interaction.source !== "planilla"
    && !interaction.aiTriage
    && !esTriajeManual(interaction)
    && Boolean(interaction.text?.trim())
    && !isMetricoolContentUnavailable(interaction.text);
}

export function toAiTriage(outcome: ClassificationOutcome, provider: AiProvider, at: string): AiTriage {
  return {
    categoria: outcome.categoria,
    tonalidad: outcome.tonalidad,
    esCasoSac: outcome.esCasoSac,
    requiereDerivacion: outcome.requiereDerivacion,
    sensible: outcome.sensible,
    ...(outcome.motivoSensible ? { motivoSensible: outcome.motivoSensible } : {}),
    confianza: outcome.confianza,
    clasificadoEn: at,
    proveedor: provider.name,
    modelo: provider.model,
    promptVersion: CLASSIFIER_PROMPT_VERSION,
  };
}

export interface AgreementCounts {
  /** Mensajes comparables: clasificados por la IA y con la otra decisión disponible. */
  compared: number;
  agree: number;
  /** Porcentaje de acuerdo con un decimal; null cuando no hay nada que comparar. */
  pct: number | null;
  /** La IA dijo caso y la otra fuente dijo ruido. */
  aiCaseOtherNoise: number;
  /** La IA dijo ruido y la otra fuente dijo caso. */
  aiNoiseOtherCase: number;
}

export interface AiAgreement {
  inbound: number;
  aiClassified: number;
  aiSensitive: number;
  /** Contra lo marcado a mano: la referencia de calidad para promover la IA. */
  vsManual: AgreementCounts;
  /** Contra las reglas sin IA (`esMensajeGestionado`), para mensajes sin marca manual. */
  vsRules: AgreementCounts;
  categories: Array<{ categoria: string; mensajes: number }>;
  models: Array<{ proveedor: string; modelo: string; promptVersion: string; mensajes: number }>;
}

function emptyCounts(): AgreementCounts {
  return { compared: 0, agree: 0, pct: null, aiCaseOtherNoise: 0, aiNoiseOtherCase: 0 };
}

function tally(counts: AgreementCounts, ai: boolean, other: boolean): void {
  counts.compared += 1;
  if (ai === other) counts.agree += 1;
  else if (ai) counts.aiCaseOtherNoise += 1;
  else counts.aiNoiseOtherCase += 1;
}

function finish(counts: AgreementCounts): AgreementCounts {
  return { ...counts, pct: counts.compared ? Math.round((counts.agree / counts.compared) * 1_000) / 10 : null };
}

/**
 * Concordancia de la IA en sombra (¿es caso SAC?) con las marcas manuales y con las reglas,
 * sobre los mensajes entrantes del período. Solo cifras: no devuelve textos ni personas.
 */
export function buildAiAgreement(
  interactions: Interaction[],
  isRuleCase: (interaction: Interaction) => boolean,
): AiAgreement {
  const inbound = interactions.filter((item) => item.direction === "inbound" && item.source !== "planilla");
  const vsManual = emptyCounts();
  const vsRules = emptyCounts();
  const categories = new Map<string, number>();
  const models = new Map<string, { proveedor: string; modelo: string; promptVersion: string; mensajes: number }>();
  let aiClassified = 0;
  let aiSensitive = 0;
  for (const item of inbound) {
    const ai = item.aiTriage;
    if (!ai) continue;
    aiClassified += 1;
    if (ai.sensible) aiSensitive += 1;
    categories.set(ai.categoria, (categories.get(ai.categoria) ?? 0) + 1);
    const modelKey = `${ai.proveedor}|${ai.modelo}|${ai.promptVersion}`;
    const model = models.get(modelKey) ?? { proveedor: ai.proveedor, modelo: ai.modelo, promptVersion: ai.promptVersion, mensajes: 0 };
    model.mensajes += 1;
    models.set(modelKey, model);
    if (esTriajeManual(item)) tally(vsManual, ai.esCasoSac, item.sacTriage!.esCasoSac);
    else tally(vsRules, ai.esCasoSac, isRuleCase({ ...item, sacTriage: undefined }));
  }
  return {
    inbound: inbound.length,
    aiClassified,
    aiSensitive,
    vsManual: finish(vsManual),
    vsRules: finish(vsRules),
    categories: [...categories].map(([categoria, mensajes]) => ({ categoria, mensajes })).sort((a, b) => b.mensajes - a.mensajes),
    models: [...models.values()].sort((a, b) => b.mensajes - a.mensajes),
  };
}

export async function runShadowTriage(
  repository: SacFlowRepository,
  options: ShadowTriageOptions,
): Promise<ShadowTriageResult> {
  const now = options.now ?? new Date();
  const usage: AiUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const result: ShadowTriageResult = { candidates: 0, classified: 0, sensitive: 0, failedBatches: 0, usage };
  if (options.brandIds !== "all" && !options.brandIds.length) return result;

  const catalog = await repository.snapshotCatalog();
  const allowedBrandIds = catalog.brands.filter((brand) => brandAllowed(brand, options.brandIds)).map((brand) => brand.id);
  if (!allowedBrandIds.length) return result;

  const from = options.from
    ?? new Date(now.getTime() - (options.lookbackDays ?? 7) * 86_400_000).toISOString();
  const interactions = await repository.listInteractions({ brandIds: allowedBrandIds, from, to: options.to });
  // Lo más reciente primero: es lo que el equipo está por atender.
  const pending = interactions
    .filter(needsShadowTriage)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, options.maxPerRun);
  result.candidates = pending.length;
  if (!pending.length) return result;

  const batches: Interaction[][] = [];
  for (let index = 0; index < pending.length; index += options.batchSize) {
    batches.push(pending.slice(index, index + options.batchSize));
  }

  const outcomes = new Map<string, ClassificationOutcome>();
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++]!;
      try {
        const classified = await classifyInteractions(batch, {
          provider: options.provider,
          batchSize: options.batchSize,
          onUsage: (batchUsage) => {
            usage.inputTokens += batchUsage.inputTokens;
            usage.outputTokens += batchUsage.outputTokens;
            usage.cachedInputTokens += batchUsage.cachedInputTokens;
          },
        });
        for (const outcome of classified) outcomes.set(outcome.id, outcome);
      } catch (error) {
        result.failedBatches += 1;
        result.firstError ??= error instanceof Error ? error.message.slice(0, 300) : "Falla desconocida.";
      }
    }
  };
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, 8));
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()));
  if (!outcomes.size) return result;

  const at = new Date().toISOString();
  const written = await repository.mutateInteractions([...outcomes.keys()], (store) => {
    let count = 0;
    let sensitive = 0;
    for (const interaction of store.interactions) {
      const outcome = outcomes.get(interaction.id);
      // Una marca manual puesta mientras la IA trabajaba manda: no se agrega nada encima.
      if (!outcome || interaction.aiTriage || esTriajeManual(interaction)) continue;
      interaction.aiTriage = toAiTriage(outcome, options.provider, at);
      interaction.audit.push({
        id: randomUUID(),
        at,
        action: "classified",
        actor: "system",
        detail: `Clasificación IA en sombra (${options.provider.name} · ${options.provider.model}): `
          + `${outcome.esCasoSac ? "caso SAC" : "ruido"}${outcome.sensible ? ", sensible: requiere revisión humana" : ""}.`,
        metadata: {
          proveedor: options.provider.name,
          modelo: options.provider.model,
          promptVersion: CLASSIFIER_PROMPT_VERSION,
          esCasoSac: outcome.esCasoSac,
          sensible: outcome.sensible,
          shadow: true,
        },
      });
      count += 1;
      if (outcome.sensible) sensitive += 1;
    }
    return { count, sensitive };
  });
  result.classified = written.count;
  result.sensitive = written.sensitive;
  return result;
}
