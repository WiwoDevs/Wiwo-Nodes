import { defaultAutomationWorkflowSettings } from "./automation-catalog.js";
import type { AutomationConnection, AutomationNode, AutomationState, AutomationWorkflow } from "./automation-types.js";

function connection(sourceNode: string, targetNode: string, sourceOutput = "main", targetInput = "main"): AutomationConnection {
  return { id: `${sourceNode}-${sourceOutput}-${targetNode}`, sourceNode, sourceOutput, targetNode, targetInput };
}

function sacWorkflow(now: string): AutomationWorkflow {
  const nodes: AutomationNode[] = [
    { id: "schedule", name: "Cada 5 minutos", type: "core.schedule", typeVersion: 1, position: { x: 40, y: 300 }, parameters: { intervalMinutes: 5 } },
    { id: "metricool", name: "Metricool Inbox", type: "sac.metricoolInbox", typeVersion: 1, position: { x: 300, y: 300 }, parameters: { operation: "preview" } },
    { id: "deduplicate", name: "Evitar duplicados", type: "core.removeDuplicates", typeVersion: 1, position: { x: 560, y: 300 }, parameters: { field: "externalId" } },
    { id: "classify", name: "Intención y riesgo", type: "sac.classify", typeVersion: 1, position: { x: 820, y: 300 }, parameters: { minimumConfidence: 0.82 } },
    { id: "safe-fields", name: "Preparar respuesta", type: "core.set", typeVersion: 1, position: { x: 1080, y: 205 }, parameters: { keepInput: true, values: { responseStatus: "drafted" } } },
    { id: "human", name: "Revisión humana", type: "sac.humanReview", typeVersion: 1, position: { x: 1080, y: 405 }, parameters: {} },
    { id: "merge", name: "Unificar resultados", type: "core.merge", typeVersion: 1, position: { x: 1340, y: 300 }, parameters: {} },
    { id: "export", name: "Preparar Excel", type: "sac.exportXlsx", typeVersion: 1, position: { x: 1600, y: 300 }, parameters: {} },
  ];
  return {
    id: "automation-sac-primary",
    projectId: "project-operations",
    folderId: "folder-sac",
    name: "SAC Multicuenta",
    description: "Orquestación principal para DMs y comentarios con Metricool, revisión humana y Excel.",
    active: true,
    archived: false,
    version: 1,
    publishedVersion: 1,
    tags: ["tag-sac", "tag-critical"],
    nodes,
    connections: [
      connection("schedule", "metricool"),
      connection("metricool", "deduplicate"),
      connection("deduplicate", "classify"),
      connection("classify", "safe-fields", "safe"),
      connection("classify", "human", "review"),
      connection("safe-fields", "merge"),
      connection("human", "merge"),
      connection("merge", "export"),
    ],
    settings: { ...defaultAutomationWorkflowSettings(), concurrency: 3 },
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  };
}

function webhookWorkflow(now: string): AutomationWorkflow {
  return {
    id: "automation-webhook-intake",
    projectId: "project-operations",
    folderId: "folder-integrations",
    name: "Recepción de leads",
    description: "Webhook de ejemplo para validar, normalizar y responder datos entrantes.",
    active: false,
    archived: false,
    version: 1,
    publishedVersion: 1,
    tags: ["tag-api"],
    nodes: [
      { id: "webhook", name: "Webhook", type: "core.webhook", typeVersion: 1, position: { x: 80, y: 250 }, parameters: { path: "leads", method: "POST" } },
      { id: "has-email", name: "Tiene email", type: "core.if", typeVersion: 1, position: { x: 360, y: 250 }, parameters: { field: "email", operator: "exists" } },
      { id: "normalize", name: "Normalizar", type: "core.set", typeVersion: 1, position: { x: 640, y: 170 }, parameters: { keepInput: true, values: { receivedAt: "{{ $now }}", source: "webhook" } } },
      { id: "invalid", name: "Marcar inválido", type: "core.set", typeVersion: 1, position: { x: 640, y: 350 }, parameters: { keepInput: true, values: { valid: false } } },
      { id: "response", name: "Responder", type: "core.respondToWebhook", typeVersion: 1, position: { x: 930, y: 250 }, parameters: { body: { accepted: true } } },
    ],
    connections: [
      connection("webhook", "has-email"),
      connection("has-email", "normalize", "true"),
      connection("has-email", "invalid", "false"),
      connection("normalize", "response"),
      connection("invalid", "response"),
    ],
    settings: defaultAutomationWorkflowSettings(),
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  };
}

function reportWorkflow(now: string): AutomationWorkflow {
  return {
    id: "automation-daily-report",
    projectId: "project-operations",
    folderId: "folder-operations",
    name: "Resumen diario de operaciones",
    description: "Pipeline local de ejemplo para ordenar, limitar y agrupar registros.",
    active: false,
    archived: false,
    version: 1,
    publishedVersion: 1,
    tags: ["tag-data"],
    nodes: [
      { id: "manual", name: "Inicio manual", type: "core.manualTrigger", typeVersion: 1, position: { x: 80, y: 250 }, parameters: {} },
      { id: "dedupe", name: "Sin duplicados", type: "core.removeDuplicates", typeVersion: 1, position: { x: 340, y: 250 }, parameters: { field: "id" } },
      { id: "sort", name: "Más recientes", type: "core.sort", typeVersion: 1, position: { x: 600, y: 250 }, parameters: { field: "createdAt", direction: "desc" } },
      { id: "limit", name: "Últimos 100", type: "core.limit", typeVersion: 1, position: { x: 860, y: 250 }, parameters: { maxItems: 100 } },
      { id: "aggregate", name: "Agrupar por estado", type: "core.aggregate", typeVersion: 1, position: { x: 1120, y: 250 }, parameters: { groupBy: "status" } },
    ],
    connections: [connection("manual", "dedupe"), connection("dedupe", "sort"), connection("sort", "limit"), connection("limit", "aggregate")],
    settings: defaultAutomationWorkflowSettings(),
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  };
}

export function createDemoAutomationState(reference = new Date()): AutomationState {
  const now = reference.toISOString();
  const workflows = [sacWorkflow(now), webhookWorkflow(now), reportWorkflow(now)];
  return {
    projects: [{ id: "project-operations", name: "Operaciones", description: "Automatizaciones generales y módulo SAC.", type: "team", color: "#4b46f5", createdAt: now, updatedAt: now }],
    folders: [
      { id: "folder-sac", projectId: "project-operations", name: "SAC", createdAt: now, updatedAt: now },
      { id: "folder-integrations", projectId: "project-operations", name: "Integraciones", createdAt: now, updatedAt: now },
      { id: "folder-operations", projectId: "project-operations", name: "Operaciones", createdAt: now, updatedAt: now },
    ],
    tags: [
      { id: "tag-sac", projectId: "project-operations", name: "SAC", color: "#315ee8", createdAt: now },
      { id: "tag-critical", projectId: "project-operations", name: "Crítico", color: "#a64b59", createdAt: now },
      { id: "tag-api", projectId: "project-operations", name: "API", color: "#187a75", createdAt: now },
      { id: "tag-data", projectId: "project-operations", name: "Datos", color: "#5f62d6", createdAt: now },
    ],
    credentials: [
      { id: "credential-metricool-placeholder", projectId: "project-operations", name: "Metricool pendiente", type: "metricoolApi", status: "unconfigured", dataKeys: [], createdAt: now, updatedAt: now },
    ],
    variables: [
      { id: "variable-environment", projectId: "project-operations", key: "ENVIRONMENT", value: "development", secret: false, createdAt: now, updatedAt: now },
      { id: "variable-default-timezone", projectId: "project-operations", key: "DEFAULT_TIMEZONE", value: "America/Santiago", secret: false, createdAt: now, updatedAt: now },
    ],
    workflows,
    workflowVersions: workflows.map((workflow) => ({
      id: `${workflow.id}-v1`, workflowId: workflow.id, version: 1, status: "published", snapshot: structuredClone(workflow), createdAt: now, createdBy: "system", changeNote: "Versión inicial de la plataforma.",
    })),
    executions: [],
  };
}
