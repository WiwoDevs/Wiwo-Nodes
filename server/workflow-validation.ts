import type { Workflow, WorkflowNode } from "./types.js";

type WorkflowValidationSeverity = "error" | "warning";

export interface WorkflowValidationIssue {
  code: string;
  severity: WorkflowValidationSeverity;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  checkedAt: string;
  errors: number;
  warnings: number;
  issues: WorkflowValidationIssue[];
}

const REQUIRED_TYPES: WorkflowNode["type"][] = [
  "schedule",
  "metricool",
  "normalize",
  "deduplicate",
  "classify",
  "guardrail",
  "reply",
  "escalate",
  "excel",
];

export function validateWorkflow(workflow: Workflow): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ code: "DUPLICATE_NODE_ID", severity: "error", message: `El nodo ${node.id} está duplicado.`, nodeId: node.id });
    }
    nodeIds.add(node.id);
    if (!node.enabled) {
      issues.push({ code: "NODE_DISABLED", severity: "warning", message: `El nodo ${node.label} está desactivado.`, nodeId: node.id });
    }
  }

  for (const type of REQUIRED_TYPES) {
    if (!workflow.nodes.some((node) => node.type === type)) {
      issues.push({ code: "REQUIRED_NODE_MISSING", severity: "error", message: `Falta un nodo obligatorio de tipo ${type}.` });
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const node of workflow.nodes) adjacency.set(node.id, []);
  for (const edge of workflow.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({ code: "DUPLICATE_EDGE_ID", severity: "error", message: `La conexión ${edge.id} está duplicada.`, edgeId: edge.id });
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({ code: "ORPHAN_EDGE", severity: "error", message: `La conexión ${edge.id} referencia un nodo inexistente.`, edgeId: edge.id });
      continue;
    }
    if (edge.source === edge.target) {
      issues.push({ code: "SELF_LOOP", severity: "error", message: `El nodo ${edge.source} no puede conectarse consigo mismo.`, edgeId: edge.id });
      continue;
    }
    adjacency.get(edge.source)?.push(edge.target);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) {
      if (visit(target)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  if (workflow.nodes.some((node) => visit(node.id))) {
    issues.push({ code: "WORKFLOW_CYCLE", severity: "error", message: "El workflow contiene un ciclo y no puede publicarse." });
  }

  const scheduleIds = workflow.nodes.filter((node) => node.type === "schedule").map((node) => node.id);
  const reachable = new Set(scheduleIds);
  const queue = [...scheduleIds];
  while (queue.length) {
    const current = queue.shift()!;
    for (const target of adjacency.get(current) ?? []) {
      if (!reachable.has(target)) {
        reachable.add(target);
        queue.push(target);
      }
    }
  }
  for (const node of workflow.nodes) {
    if (!reachable.has(node.id)) {
      issues.push({ code: "UNREACHABLE_NODE", severity: "error", message: `El nodo ${node.label} no es alcanzable desde el disparador.`, nodeId: node.id });
    }
  }

  if (workflow.autoReplyEnabled && workflow.autoReplyAccountIds.length === 0) {
    issues.push({ code: "EMPTY_AUTO_REPLY_ALLOWLIST", severity: "error", message: "El autoenvío está activo pero no tiene cuentas autorizadas." });
  }
  if (workflow.minimumConfidence < 0.8) {
    issues.push({ code: "LOW_CONFIDENCE_THRESHOLD", severity: "warning", message: "El umbral de confianza es inferior a 0,80." });
  }
  if (!workflow.requireHumanFor.includes("reclamo") || !workflow.requireHumanFor.includes("crisis")) {
    issues.push({ code: "HUMAN_REVIEW_GAP", severity: "error", message: "Las categorías sensibles obligatorias deben conservar revisión humana." });
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  return {
    valid: errors === 0,
    checkedAt: new Date().toISOString(),
    errors,
    warnings: issues.length - errors,
    issues,
  };
}
