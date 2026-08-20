import { createHash } from "node:crypto";
import {
  CHANNELS,
  INTERACTION_STATUSES,
  INTERACTION_TYPES,
  SENTIMENTS,
  type Channel,
  type DataStore,
  type Interaction,
  type InteractionStatus,
  type InteractionType,
  type ReplyDelivery,
  type Sentiment,
} from "./types.js";

type StoreAuditSeverity = "error" | "warning";

export interface StoreAuditIssue {
  severity: StoreAuditSeverity;
  code: string;
  message: string;
  count?: number;
  sampleIds?: string[];
}

export interface StoreAuditReport {
  ok: boolean;
  generatedAt: string;
  sha256: string;
  counts: {
    brands: number;
    activeBrands: number;
    accounts: number;
    activeAccounts: number;
    interactions: number;
    deliveries: number;
    workflowNodes: number;
    workflowEdges: number;
    runs: number;
    idempotency: number;
  };
  interactions: {
    byChannel: Record<Channel, number>;
    byType: Record<InteractionType, number>;
    byStatus: Record<InteractionStatus, number>;
    bySentiment: Record<Sentiment, number>;
    inbound: number;
    outbound: number;
    metricoolSource: number;
    demoSource: number;
    withResponseText: number;
    withMetricoolRef: number;
  };
  metricool: {
    configuredAccounts: number;
    unconfiguredAccounts: number;
    partialReferences: number;
  };
  workflow: {
    id?: string;
    enabled: boolean;
    autoReplyEnabled: boolean;
    autoReplyAllowlistCount: number;
    missingAllowlistAccounts: string[];
  };
  dataRisks: {
    formulaLikeFields: number;
    invalidDates: number;
    duplicateExternalKeys: number;
    orphanInteractions: number;
    orphanDeliveries: number;
    invalidEnumValues: number;
    invalidCoordinationFields: number;
  };
  issues: StoreAuditIssue[];
}

type MaybeStore = Partial<DataStore> & Record<string, unknown>;

const FORMULA_PREFIX = /^[\s]*[=+\-@]/;

function zeroRecord<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

function sample(values: Iterable<string>, limit = 5): string[] {
  return Array.from(values).slice(0, limit);
}

function sha256For(rawText: string | undefined, store: unknown): string {
  const source = rawText ?? JSON.stringify(store);
  return createHash("sha256").update(source ?? "").digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function validDate(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  return Number.isFinite(Date.parse(value));
}

function countFormulaRisk(value: unknown): number {
  return typeof value === "string" && FORMULA_PREFIX.test(value) ? 1 : 0;
}

function stringSet(values: readonly string[]): Set<string> {
  return new Set(values.filter(Boolean));
}

function pushIssue(
  issues: StoreAuditIssue[],
  severity: StoreAuditSeverity,
  code: string,
  message: string,
  count?: number,
  sampleIds?: string[],
): void {
  issues.push({
    severity,
    code,
    message,
    ...(count !== undefined ? { count } : {}),
    ...(sampleIds && sampleIds.length ? { sampleIds } : {}),
  });
}

function duplicated(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return new Map(Array.from(counts.entries()).filter(([, count]) => count > 1));
}

export function auditDataStore(candidate: unknown, rawText?: string): StoreAuditReport {
  const issues: StoreAuditIssue[] = [];
  const store: MaybeStore = isObject(candidate) ? candidate as MaybeStore : {};
  if (!isObject(candidate)) {
    pushIssue(issues, "error", "invalid_store", "El archivo debe contener un objeto JSON raíz.");
  }
  if (store.version !== 1) {
    pushIssue(issues, "error", "unsupported_version", "El archivo debe usar version=1.");
  }

  const brands = safeArray<DataStore["brands"][number]>(store.brands);
  const interactions = safeArray<Interaction>(store.interactions);
  const deliveries = safeArray<ReplyDelivery>(store.deliveries);
  const workflow = isObject(store.workflow) ? store.workflow as Partial<DataStore["workflow"]> : {};
  const runs = safeArray<DataStore["runs"][number]>(store.runs);
  const idempotency = safeArray<DataStore["idempotency"][number]>(store.idempotency);

  for (const [field, value] of Object.entries({
    brands: store.brands,
    interactions: store.interactions,
    runs: store.runs,
    idempotency: store.idempotency,
  })) {
    if (!Array.isArray(value)) {
      pushIssue(issues, "error", "invalid_array_field", `El campo ${field} debe ser un arreglo.`);
    }
  }
  if (store.deliveries !== undefined && !Array.isArray(store.deliveries)) {
    pushIssue(issues, "error", "invalid_array_field", "El campo deliveries debe ser un arreglo cuando está presente.");
  }
  if (!isObject(store.workflow)) {
    pushIssue(issues, "error", "invalid_workflow", "El campo workflow debe ser un objeto.");
  }

  const brandIds = brands.map((brand) => brand.id).filter(Boolean);
  const accountIds = brands.map((brand) => brand.account?.id).filter(Boolean);
  const brandIdSet = stringSet(brandIds);
  const accountIdSet = stringSet(accountIds);
  const brandToAccount = new Map(brands.map((brand) => [brand.id, brand.account?.id]));
  const duplicateBrandIds = duplicated(brandIds);
  const duplicateAccountIds = duplicated(accountIds);

  if (duplicateBrandIds.size) {
    pushIssue(
      issues,
      "error",
      "duplicate_brand_ids",
      "Hay marcas con id duplicado; PostgreSQL rechazará la importación.",
      duplicateBrandIds.size,
      sample(duplicateBrandIds.keys()),
    );
  }
  if (duplicateAccountIds.size) {
    pushIssue(
      issues,
      "error",
      "duplicate_account_ids",
      "Hay cuentas con id duplicado; PostgreSQL rechazará la importación.",
      duplicateAccountIds.size,
      sample(duplicateAccountIds.keys()),
    );
  }

  let formulaLikeFields = 0;
  let invalidDates = 0;
  let invalidEnumValues = 0;
  let configuredAccounts = 0;
  let partialReferences = 0;
  const orphanInteractionIds = new Set<string>();
  const duplicateExternalKeys = new Set<string>();
  const interactionIdSet = new Set(interactions.map((interaction) => interaction.id));
  const orphanDeliveryIds = new Set(
    deliveries.filter((delivery) => !interactionIdSet.has(delivery.interactionId)).map((delivery) => delivery.id),
  );

  for (const brand of brands) {
    formulaLikeFields += countFormulaRisk(brand.name);
    formulaLikeFields += countFormulaRisk(brand.account?.name);
    if (brand.account?.brandId !== brand.id) {
      pushIssue(
        issues,
        "error",
        "account_brand_mismatch",
        "Una o más cuentas no apuntan a la marca que las contiene.",
        1,
        [brand.account?.id || brand.id].filter(Boolean),
      );
    }
    const channels = safeArray<Channel>(brand.account?.channels);
    if (!channels.length || channels.some((channel) => !CHANNELS.includes(channel))) {
      invalidEnumValues += 1;
      pushIssue(
        issues,
        "error",
        "invalid_account_channels",
        "Una o más cuentas tienen canales vacíos o fuera de las plataformas compatibles con Metricool Inbox.",
        1,
        [brand.account?.id || brand.id].filter(Boolean),
      );
    }
    const metricool = brand.account?.metricool;
    if (metricool?.userId && metricool.blogId) configuredAccounts += 1;
    if ((metricool?.userId && !metricool.blogId) || (!metricool?.userId && metricool?.blogId)) {
      partialReferences += 1;
    }
  }

  if (partialReferences) {
    pushIssue(
      issues,
      "error",
      "partial_metricool_references",
      "Hay referencias Metricool incompletas; cada cuenta necesita userId y blogId o ninguno.",
      partialReferences,
    );
  }

  const byChannel = zeroRecord(CHANNELS);
  const byType = zeroRecord(INTERACTION_TYPES);
  const byStatus = zeroRecord(INTERACTION_STATUSES);
  const bySentiment = zeroRecord(SENTIMENTS);
  let inbound = 0;
  let outbound = 0;
  let metricoolSource = 0;
  let demoSource = 0;
  let withResponseText = 0;
  let withMetricoolRef = 0;
  let invalidCoordinationFields = 0;
  const externalKeys = new Map<string, string>();

  for (const interaction of interactions) {
    const id = interaction.id || "(sin-id)";
    if (!brandIdSet.has(interaction.brandId) || !accountIdSet.has(interaction.accountId)) {
      orphanInteractionIds.add(id);
    } else if (brandToAccount.get(interaction.brandId) !== interaction.accountId) {
      orphanInteractionIds.add(id);
    }

    if (CHANNELS.includes(interaction.channel)) byChannel[interaction.channel] += 1;
    else invalidEnumValues += 1;
    if (INTERACTION_TYPES.includes(interaction.type)) byType[interaction.type] += 1;
    else invalidEnumValues += 1;
    if (INTERACTION_STATUSES.includes(interaction.status)) byStatus[interaction.status] += 1;
    else invalidEnumValues += 1;
    if (SENTIMENTS.includes(interaction.sentiment)) bySentiment[interaction.sentiment] += 1;
    else invalidEnumValues += 1;
    if (interaction.direction === "inbound") inbound += 1;
    else if (interaction.direction === "outbound") outbound += 1;
    else invalidEnumValues += 1;
    if (interaction.source === "metricool") metricoolSource += 1;
    else if (interaction.source === "demo") demoSource += 1;
    else invalidEnumValues += 1;

    if (!validDate(interaction.createdAt)) invalidDates += 1;
    if (!validDate(interaction.updatedAt)) invalidDates += 1;
    if (interaction.respondedAt && !validDate(interaction.respondedAt)) invalidDates += 1;
    if (interaction.version !== undefined && (!Number.isInteger(interaction.version) || interaction.version < 1)) {
      invalidCoordinationFields += 1;
    }
    if (interaction.assignedTo
      && (!interaction.assignedTo.userId?.trim() || !interaction.assignedTo.displayName?.trim())) {
      invalidCoordinationFields += 1;
    }
    if (interaction.internalNotes !== undefined && !Array.isArray(interaction.internalNotes)) {
      invalidCoordinationFields += 1;
    }
    for (const note of Array.isArray(interaction.internalNotes) ? interaction.internalNotes : []) {
      if (!note.id?.trim() || !note.authorId?.trim() || !note.authorName?.trim() || !note.text?.trim()) {
        invalidCoordinationFields += 1;
      }
      if (!validDate(note.createdAt)) invalidDates += 1;
      formulaLikeFields += countFormulaRisk(note.text);
    }
    formulaLikeFields += countFormulaRisk(interaction.customerName);
    formulaLikeFields += countFormulaRisk(interaction.text);
    formulaLikeFields += countFormulaRisk(interaction.category);
    formulaLikeFields += countFormulaRisk(interaction.responseText);
    if (interaction.responseText) withResponseText += 1;
    if (interaction.metricoolRef && Object.keys(interaction.metricoolRef).length > 0) withMetricoolRef += 1;

    const externalKey = `${interaction.accountId}:${interaction.type}:${interaction.externalId}`;
    const previous = externalKeys.get(externalKey);
    if (previous) {
      duplicateExternalKeys.add(previous);
      duplicateExternalKeys.add(id);
    } else {
      externalKeys.set(externalKey, id);
    }
  }

  if (orphanInteractionIds.size) {
    pushIssue(
      issues,
      "error",
      "orphan_interactions",
      "Hay interacciones apuntando a marcas/cuentas inexistentes o cruzadas.",
      orphanInteractionIds.size,
      sample(orphanInteractionIds),
    );
  }
  if (duplicateExternalKeys.size) {
    pushIssue(
      issues,
      "error",
      "duplicate_interactions",
      "Hay interacciones duplicadas para la misma cuenta, tipo y externalId.",
      duplicateExternalKeys.size,
      sample(duplicateExternalKeys),
    );
  }
  if (orphanDeliveryIds.size) {
    pushIssue(
      issues,
      "error",
      "orphan_deliveries",
      "Hay entregas de respuesta apuntando a interacciones inexistentes.",
      orphanDeliveryIds.size,
      sample(orphanDeliveryIds),
    );
  }
  if (invalidDates) {
    pushIssue(
      issues,
      "error",
      "invalid_dates",
      "Hay timestamps inválidos en interacciones o respuestas.",
      invalidDates,
    );
  }
  if (invalidEnumValues) {
    pushIssue(
      issues,
      "error",
      "invalid_enum_values",
      "Hay valores fuera del contrato esperado para canal, tipo, estado, sentimiento, dirección o fuente.",
      invalidEnumValues,
    );
  }
  if (invalidCoordinationFields) {
    pushIssue(
      issues,
      "error",
      "invalid_coordination_fields",
      "Hay versiones, asignaciones o notas internas con una estructura inválida.",
      invalidCoordinationFields,
    );
  }
  if (formulaLikeFields) {
    pushIssue(
      issues,
      "warning",
      "excel_formula_risk",
      "Hay textos que empiezan como fórmula de Excel; el exportador debe mantener sanitización activa.",
      formulaLikeFields,
    );
  }

  const workflowAccountIds = safeArray<string>(workflow.autoReplyAccountIds);
  const missingAllowlistAccounts = workflowAccountIds.filter((accountId) => !accountIdSet.has(accountId));
  if (missingAllowlistAccounts.length) {
    pushIssue(
      issues,
      "error",
      "workflow_allowlist_unknown_accounts",
      "La allowlist de respuestas automáticas contiene cuentas inexistentes.",
      missingAllowlistAccounts.length,
      sample(missingAllowlistAccounts),
    );
  }
  if (workflow.autoReplyEnabled === true && workflowAccountIds.length === 0) {
    pushIssue(
      issues,
      "warning",
      "autoreply_enabled_without_accounts",
      "Las respuestas automáticas están activas, pero no hay cuentas habilitadas en la allowlist.",
    );
  }

  const workflowNodes = safeArray<DataStore["workflow"]["nodes"][number]>(workflow.nodes);
  const workflowEdges = safeArray<DataStore["workflow"]["edges"][number]>(workflow.edges);
  const nodeIds = stringSet(workflowNodes.map((node) => node.id));
  const brokenEdges = workflowEdges.filter((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target));
  if (brokenEdges.length) {
    pushIssue(
      issues,
      "error",
      "workflow_edges_unknown_nodes",
      "Hay conexiones del workflow apuntando a nodos inexistentes.",
      brokenEdges.length,
      sample(brokenEdges.map((edge) => edge.id)),
    );
  }

  const report: StoreAuditReport = {
    ok: !issues.some((issue) => issue.severity === "error"),
    generatedAt: new Date().toISOString(),
    sha256: sha256For(rawText, candidate),
    counts: {
      brands: brands.length,
      activeBrands: brands.filter((brand) => brand.active).length,
      accounts: brands.filter((brand) => brand.account).length,
      activeAccounts: brands.filter((brand) => brand.account?.active).length,
      interactions: interactions.length,
      deliveries: deliveries.length,
      workflowNodes: workflowNodes.length,
      workflowEdges: workflowEdges.length,
      runs: runs.length,
      idempotency: idempotency.length,
    },
    interactions: {
      byChannel,
      byType,
      byStatus,
      bySentiment,
      inbound,
      outbound,
      metricoolSource,
      demoSource,
      withResponseText,
      withMetricoolRef,
    },
    metricool: {
      configuredAccounts,
      unconfiguredAccounts: Math.max(0, brands.length - configuredAccounts - partialReferences),
      partialReferences,
    },
    workflow: {
      id: typeof workflow.id === "string" ? workflow.id : undefined,
      enabled: workflow.enabled === true,
      autoReplyEnabled: workflow.autoReplyEnabled === true,
      autoReplyAllowlistCount: workflowAccountIds.length,
      missingAllowlistAccounts,
    },
    dataRisks: {
      formulaLikeFields,
      invalidDates,
      duplicateExternalKeys: duplicateExternalKeys.size,
      orphanInteractions: orphanInteractionIds.size,
      orphanDeliveries: orphanDeliveryIds.size,
      invalidEnumValues,
      invalidCoordinationFields,
    },
    issues,
  };

  return report;
}
