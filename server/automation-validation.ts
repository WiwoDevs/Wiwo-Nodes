import { getAutomationNodeDefinition } from "./automation-catalog.js";
import type { AutomationState, AutomationValidationIssue, AutomationValidationResult, AutomationWorkflow } from "./automation-types.js";

function push(issues: AutomationValidationIssue[], issue: AutomationValidationIssue): void {
  if (!issues.some((item) => item.code === issue.code && item.nodeId === issue.nodeId && item.connectionId === issue.connectionId)) {
    issues.push(issue);
  }
}

export function validateAutomationWorkflow(workflow: AutomationWorkflow, state: AutomationState): AutomationValidationResult {
  const issues: AutomationValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const names = new Set<string>();
  const adjacency = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  const webhookKeys = new Set<string>();

  try {
    new Intl.DateTimeFormat("en", { timeZone: workflow.settings.timezone });
  } catch {
    push(issues, { level: "error", code: "INVALID_TIMEZONE", message: "La zona horaria del workflow no es válida." });
  }
  if (!Number.isInteger(workflow.settings.executionTimeoutSeconds) || workflow.settings.executionTimeoutSeconds < 1 || workflow.settings.executionTimeoutSeconds > 86_400) {
    push(issues, { level: "error", code: "INVALID_TIMEOUT", message: "El timeout debe estar entre 1 y 86400 segundos." });
  }
  if (!Number.isInteger(workflow.settings.concurrency) || workflow.settings.concurrency < 1 || workflow.settings.concurrency > 100) {
    push(issues, { level: "error", code: "INVALID_CONCURRENCY", message: "La concurrencia debe estar entre 1 y 100." });
  }

  if (workflow.settings.errorWorkflowId === workflow.id) {
    push(issues, { level: "error", code: "SELF_ERROR_WORKFLOW", message: "Un workflow no puede ser su propio manejador de errores." });
  } else if (workflow.settings.errorWorkflowId && !state.workflows.some((item) => item.id === workflow.settings.errorWorkflowId && !item.archived)) {
    push(issues, { level: "error", code: "UNKNOWN_ERROR_WORKFLOW", message: "El workflow de error configurado no existe." });
  }

  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) push(issues, { level: "error", code: "DUPLICATE_NODE_ID", message: "El workflow contiene IDs de nodo duplicados.", nodeId: node.id });
    nodeIds.add(node.id);
    const normalizedName = node.name.trim().toLocaleLowerCase("es-CL");
    if (!normalizedName) push(issues, { level: "error", code: "NODE_NAME_REQUIRED", message: "Todos los nodos necesitan un nombre.", nodeId: node.id });
    if (names.has(normalizedName)) push(issues, { level: "warning", code: "DUPLICATE_NODE_NAME", message: `El nombre ${node.name} se repite.`, nodeId: node.id });
    names.add(normalizedName);
    adjacency.set(node.id, []);
    incoming.set(node.id, 0);

    const definition = getAutomationNodeDefinition(node.type);
    if (!definition) {
      push(issues, { level: "error", code: "UNKNOWN_NODE_TYPE", message: `El tipo ${node.type} no está instalado.`, nodeId: node.id });
      continue;
    }
    if (node.typeVersion !== definition.version) push(issues, { level: "error", code: "NODE_VERSION_MISMATCH", message: `${node.name} usa una versión de nodo no instalada.`, nodeId: node.id });
    if (!definition.executable) push(issues, { level: "error", code: "NODE_NOT_EXECUTABLE", message: `${definition.name} aún no puede ejecutarse.`, nodeId: node.id });
    for (const parameter of definition.parameters) {
      const value = node.parameters[parameter.key];
      if (parameter.required && (value === undefined || value === null || value === "")) {
        push(issues, { level: "error", code: "MISSING_PARAMETER", message: `Falta ${parameter.label} en ${node.name}.`, nodeId: node.id });
        continue;
      }
      if (value === undefined || value === null || value === "") continue;
      const expression = typeof value === "string" && value.includes("{{");
      const validType = expression
        || parameter.type === "json" && typeof value === "object"
        || parameter.type === "number" && typeof value === "number" && Number.isFinite(value)
        || parameter.type === "boolean" && typeof value === "boolean"
        || ["string", "select", "credential", "workflow"].includes(parameter.type) && typeof value === "string";
      if (!validType) push(issues, { level: "error", code: "INVALID_PARAMETER_TYPE", message: `${parameter.label} tiene un tipo inválido en ${node.name}.`, nodeId: node.id });
      if (parameter.type === "select" && !expression && parameter.options?.length && !parameter.options.some((option) => option.value === value)) {
        push(issues, { level: "error", code: "INVALID_PARAMETER_OPTION", message: `${parameter.label} contiene una opción no permitida en ${node.name}.`, nodeId: node.id });
      }
    }
    if (definition.credentialTypes?.length) {
      if (!node.credentialId && node.type !== "sac.metricoolInbox") {
        push(issues, { level: "warning", code: "MISSING_CREDENTIAL", message: `${node.name} no tiene credencial asignada.`, nodeId: node.id });
      } else if (node.credentialId && !state.credentials.some((credential) => credential.id === node.credentialId && credential.projectId === workflow.projectId)) {
        push(issues, { level: "error", code: "UNKNOWN_CREDENTIAL", message: `${node.name} referencia una credencial inexistente.`, nodeId: node.id });
      } else if (node.credentialId && !state.credentials.some((credential) => credential.id === node.credentialId && definition.credentialTypes?.includes(credential.type))) {
        push(issues, { level: "error", code: "INCOMPATIBLE_CREDENTIAL", message: `${node.name} usa un tipo de credencial incompatible.`, nodeId: node.id });
      }
    }
    if (node.type === "core.webhook" && node.parameters.authentication === "credential") {
      if (!node.credentialId) push(issues, { level: "error", code: "WEBHOOK_CREDENTIAL_REQUIRED", message: "El webhook requiere una credencial adicional.", nodeId: node.id });
      else if (!state.credentials.some((credential) => credential.id === node.credentialId && credential.projectId === workflow.projectId && credential.status === "configured")) {
        push(issues, { level: "error", code: "WEBHOOK_CREDENTIAL_INVALID", message: "La credencial del webhook no está configurada en el proyecto.", nodeId: node.id });
      }
    }
    if (["core.webhook", "core.formTrigger"].includes(node.type) && !node.disabled) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(String(node.parameters.path || ""))) {
        push(issues, { level: "error", code: "INVALID_WEBHOOK_PATH", message: "La ruta del webhook debe usar entre 1 y 80 letras, números, guiones o guiones bajos.", nodeId: node.id });
      }
      const key = `${String(node.parameters.method || "POST").toUpperCase()}:${String(node.parameters.path || "")}`;
      if (webhookKeys.has(key)) push(issues, { level: "error", code: "DUPLICATE_WEBHOOK_PATH", message: `La ruta ${key} se repite dentro del workflow.`, nodeId: node.id });
      webhookKeys.add(key);
      const conflict = state.workflows.find((candidate) => candidate.id !== workflow.id && candidate.active && !candidate.archived && candidate.nodes.some((other) => !other.disabled && ["core.webhook", "core.formTrigger"].includes(other.type) && `${String(other.parameters.method || "POST").toUpperCase()}:${String(other.parameters.path || "")}` === key));
      if (conflict) push(issues, { level: "error", code: "WEBHOOK_PATH_CONFLICT", message: `La ruta ${key} ya está activa en ${conflict.name}.`, nodeId: node.id });
    }
    if (node.type === "core.executeWorkflow") {
      const targetId = String(node.parameters.workflowId || "");
      if (targetId === workflow.id) push(issues, { level: "error", code: "SELF_SUBWORKFLOW", message: "Un workflow no puede ejecutarse a sí mismo.", nodeId: node.id });
      else if (!state.workflows.some((item) => item.id === targetId && !item.archived)) push(issues, { level: "error", code: "UNKNOWN_SUBWORKFLOW", message: "El subworkflow seleccionado no existe.", nodeId: node.id });
    }
    const boundedParameter = ({
      "core.schedule": ["intervalMinutes", 1, 43_200],
      "core.limit": ["maxItems", 0, 10_000],
      "core.wait": ["milliseconds", 0, 2_000],
      "sac.classify": ["minimumConfidence", 0, 1],
    } as Record<string, [string, number, number] | undefined>)[node.type];
    if (boundedParameter) {
      const [key, minimum, maximum] = boundedParameter;
      const value = node.parameters[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
        push(issues, { level: "error", code: "PARAMETER_OUT_OF_RANGE", message: `${node.name}: ${key} debe estar entre ${minimum} y ${maximum}.`, nodeId: node.id });
      }
    }
  }

  const connectionIds = new Set<string>();
  const connectionRoutes = new Set<string>();
  const enabledIds = new Set(workflow.nodes.filter((node) => !node.disabled).map((node) => node.id));
  for (const connection of workflow.connections) {
    if (connectionIds.has(connection.id)) push(issues, { level: "error", code: "DUPLICATE_CONNECTION_ID", message: "El workflow contiene conexiones duplicadas.", connectionId: connection.id });
    connectionIds.add(connection.id);
    if (!nodeIds.has(connection.sourceNode) || !nodeIds.has(connection.targetNode)) {
      push(issues, { level: "error", code: "ORPHAN_CONNECTION", message: "Una conexión referencia un nodo inexistente.", connectionId: connection.id });
      continue;
    }
    if (connection.sourceNode === connection.targetNode) push(issues, { level: "error", code: "SELF_CONNECTION", message: "Un nodo no puede conectarse consigo mismo.", connectionId: connection.id });
    const route = `${connection.sourceNode}:${connection.sourceOutput}:${connection.targetNode}:${connection.targetInput}`;
    if (connectionRoutes.has(route)) push(issues, { level: "error", code: "DUPLICATE_CONNECTION", message: "La misma ruta entre nodos está conectada más de una vez.", connectionId: connection.id });
    connectionRoutes.add(route);
    const sourceDefinition = getAutomationNodeDefinition(workflow.nodes.find((node) => node.id === connection.sourceNode)?.type || "");
    if (sourceDefinition && !sourceDefinition.outputs.includes(connection.sourceOutput)) {
      push(issues, { level: "error", code: "UNKNOWN_OUTPUT", message: `La salida ${connection.sourceOutput} no existe en el nodo origen.`, connectionId: connection.id });
    }
    const targetDefinition = getAutomationNodeDefinition(workflow.nodes.find((node) => node.id === connection.targetNode)?.type || "");
    if (targetDefinition?.trigger) push(issues, { level: "error", code: "TRIGGER_HAS_INPUT", message: "Un trigger no puede recibir conexiones de entrada.", connectionId: connection.id });
    if (enabledIds.has(connection.sourceNode) && enabledIds.has(connection.targetNode)) {
      adjacency.get(connection.sourceNode)?.push(connection.targetNode);
      incoming.set(connection.targetNode, (incoming.get(connection.targetNode) || 0) + 1);
    }
  }

  const enabledNodes = workflow.nodes.filter((node) => !node.disabled);
  const triggers = enabledNodes.filter((node) => getAutomationNodeDefinition(node.type)?.trigger);
  if (!triggers.length) push(issues, { level: "error", code: "TRIGGER_REQUIRED", message: "El workflow necesita al menos un trigger habilitado." });
  if (enabledNodes.length === 1) push(issues, { level: "warning", code: "NO_ACTION_NODES", message: "El workflow solo contiene un trigger." });

  const indegree = new Map(incoming);
  const queue = enabledNodes.filter((node) => (indegree.get(node.id) || 0) === 0).map((node) => node.id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const target of adjacency.get(id) || []) {
      const next = (indegree.get(target) || 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  if (visited !== enabledNodes.length) push(issues, { level: "error", code: "CYCLE_DETECTED", message: "El workflow contiene un ciclo no permitido." });

  const reachable = new Set<string>();
  const reachQueue = triggers.map((node) => node.id);
  while (reachQueue.length) {
    const id = reachQueue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    reachQueue.push(...(adjacency.get(id) || []));
  }
  for (const node of enabledNodes) {
    if (!reachable.has(node.id)) push(issues, { level: "warning", code: "UNREACHABLE_NODE", message: `${node.name} no es alcanzable desde un trigger.`, nodeId: node.id });
  }

  if (workflow.active && workflow.version !== workflow.publishedVersion) {
    push(issues, { level: "error", code: "ACTIVE_DRAFT_MISMATCH", message: "Un workflow activo debe coincidir con su versión publicada." });
  }

  const references = (candidate: AutomationWorkflow) => [
    candidate.settings.errorWorkflowId,
    ...candidate.nodes.filter((node) => !node.disabled && node.type === "core.executeWorkflow").map((node) => String(node.parameters.workflowId || "")),
  ].filter((value): value is string => Boolean(value));
  const pending = references(workflow);
  const seenWorkflows = new Set<string>();
  while (pending.length) {
    const workflowId = pending.shift()!;
    if (workflowId === workflow.id) {
      push(issues, { level: "error", code: "SUBWORKFLOW_CYCLE", message: "Las referencias entre workflows forman un ciclo." });
      break;
    }
    if (seenWorkflows.has(workflowId)) continue;
    seenWorkflows.add(workflowId);
    const referenced = state.workflows.find((candidate) => candidate.id === workflowId && !candidate.archived);
    if (referenced) pending.push(...references(referenced));
  }

  const errors = issues.filter((issue) => issue.level === "error").length;
  const warnings = issues.length - errors;
  return { valid: errors === 0, errors, warnings, issues };
}
